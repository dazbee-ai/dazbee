"""The layer split (ADR-0022): Ming-Image-0.1-Design-Layer on ComfyUI, on one H100, as a deployed Modal app.

`Layering.split` takes a `contract.LayerSplitRequest` and gives back a `contract.LayerSplitResult`: the
picture's layers as PNGs, top first, the split pieces cut from them when the request has planned parts
(`pieces`), and the seconds its container worked on the call, timed inside the function, with the CPU cores and
memory the function declares. The worker spawns it through Modal's JavaScript SDK and asks for its result by the
call's id (packages/ai/src/sellers/modal.ts).

ComfyUI runs as a server inside the container, and a GPU memory snapshot holds it with the model loaded, so
a cold container starts from the snapshot instead of loading the weights. At most 2 containers run, each
stops after 5 s with no call, and none is kept warm. A container is billed from its start to its stop, so
each call says what of that falls to it: the first call a container serves, how long the start took since
it was asked for and the wait before the stop; each later call, how long the container waited for it.

    modal deploy app.py                 (from python/layering; development, the default environment)
    modal deploy --env prod app.py      (production, which the worker's MODAL_ENVIRONMENT names; the
                                         Deploy workflow's job `layering` runs this)
"""

import base64
import io
import json
import subprocess
import time
import traceback
import urllib.error
import urllib.request
import uuid

import modal

import weights
from contract import Layer, LayerSplitRequest, LayerSplitResult, Part
from weights import COMFYUI
from workflow import default_plan, layer_split_graph, working_size

APP_NAME = "dazbee-layering"

COMFYUI_VERSION = "v0.46.0"
COMFYUI_URL = "http://127.0.0.1:8188"

# What the function declares besides its GPU; the worker prices these for the seconds a call takes.
CPU_CORES = 4.0
MEMORY_MIB = 32 * 1024

# How long a container waits for another call before it stops, in seconds: billed, so kept short. The
# splits of one job are asked for together and find the container still working.
WAIT_S = 5

# How long ComfyUI may take to start, and to load the model and split once, before the snapshot.
START_TIMEOUT_S = 15 * 60
# How long one split may run; the worker stops waiting at 10 minutes.
SPLIT_TIMEOUT_S = 8 * 60
# How long ComfyUI may take to accept a graph: the first one after a restore waits for the model's memory.
QUEUE_TIMEOUT_S = 2 * 60

image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("git", "libgl1", "libglib2.0-0")
    .run_commands(f"git clone --depth 1 --branch {COMFYUI_VERSION} https://github.com/Comfy-Org/ComfyUI.git {COMFYUI}")
    .uv_pip_install("torch==2.14.1", "torchvision==0.29.2")
    .run_commands(f"pip install --no-cache-dir -r {COMFYUI}/requirements.txt")
    .uv_pip_install("huggingface_hub[hf_xet]==2.4.0", "pydantic==2.14.4")
    .run_function(weights.download, cpu=2.0, memory=4096, timeout=3600)
    # What cutting split pieces needs, after the weights so a change here keeps their layer.
    .uv_pip_install(
        "numpy==2.5.5",
        "opencv-python-headless==5.1.0.95",
        "pillow==13.0.0",
        "scikit-image==0.26.0",
        "scipy==1.18.1",
    )
    .add_local_python_source("contract", "pieces", "weights", "workflow")
)

app = modal.App(APP_NAME)


@app.cls(
    image=image,
    gpu="H100!",
    cpu=CPU_CORES,
    memory=MEMORY_MIB,
    enable_memory_snapshot=True,
    experimental_options={"enable_gpu_snapshot": True},
    max_containers=2,
    min_containers=0,
    scaledown_window=WAIT_S,
    timeout=SPLIT_TIMEOUT_S,
    startup_timeout=START_TIMEOUT_S,
)
class Layering:
    @modal.enter(snap=True)
    def start(self) -> None:
        """Starts ComfyUI and splits a small picture once, so the snapshot holds the model on the GPU."""
        self.server = subprocess.Popen(
            [
                "python",
                "main.py",
                "--listen",
                "127.0.0.1",
                "--port",
                "8188",
                "--highvram",
                "--disable-dynamic-vram",
                "--disable-metadata",
                "--disable-auto-launch",
                "--database-url",
                "sqlite:///:memory:",
            ],
            cwd=COMFYUI,
        )
        wait_until_up(self.server)
        warm = save_input(test_picture(), "warm-up")
        run_graph(layer_split_graph(warm, 512, 512, "Decompose this image into 1 layers.", None, steps=1))
        # When the container's last call ended, on its own clock; none until it has served one.
        self.last_done: float | None = None

    @modal.enter(snap=False)
    def ready(self) -> None:
        """Waits for ComfyUI to answer again in a container restored from the snapshot, before any call."""
        wait_until_up(self.server)

    @modal.method()
    def split(self, request: dict) -> dict:
        """Splits the request's picture into layers; see the module's docstring."""
        started = time.monotonic()
        call = LayerSplitRequest.model_validate(request)
        first = self.last_done is None
        idle = None if self.last_done is None else round(started - self.last_done, 3)
        waited = None if call.askedAt is None else round(max(0.0, time.time() - call.askedAt / 1000), 3)
        from PIL import Image

        picture = Image.open(io.BytesIO(base64.b64decode(call.picture))).convert("RGB")
        width, height = working_size(picture.width, picture.height, int(call.size))
        name = save_input(picture.resize((width, height), Image.Resampling.LANCZOS), uuid.uuid4().hex)
        try:
            files = run_graph(layer_split_graph(name, width, height, call.plan or default_plan(), call.guidance))
            layers = [read_layer(file) for file in files]
            pieces = cut_pieces(picture, call.parts, layers) if call.parts else None
        finally:
            (COMFYUI / "input" / name).unlink(missing_ok=True)
            self.last_done = time.monotonic()
        return LayerSplitResult(
            layers=layers,
            pieces=pieces,
            seconds=round(self.last_done - started, 3),
            cpuCores=CPU_CORES,
            memoryGib=MEMORY_MIB / 1024,
            startSeconds=waited if first else None,
            idleSeconds=idle,
            waitSeconds=WAIT_S,
        ).model_dump(mode="json")

    @modal.exit()
    def stop(self) -> None:
        self.server.terminate()


def wait_until_up(server: subprocess.Popen) -> None:
    """Waits for ComfyUI's server to answer; fails when it exits or takes too long."""
    until = time.monotonic() + START_TIMEOUT_S
    while time.monotonic() < until:
        if server.poll() is not None:
            raise RuntimeError(f"ComfyUI exited with {server.returncode} while starting")
        try:
            with urllib.request.urlopen(f"{COMFYUI_URL}/system_stats", timeout=5):
                return
        except (urllib.error.URLError, ConnectionError):
            time.sleep(0.5)
    raise RuntimeError("ComfyUI did not start in time")


def save_input(picture, stem: str) -> str:
    """Saves `picture` (a Pillow image) as a PNG in ComfyUI's input folder; its file name there."""
    name = f"{stem}.png"
    picture.save(COMFYUI / "input" / name)
    return name


def test_picture():
    """A plain 512 px picture with two shapes, for the split that warms the model up before the snapshot."""
    from PIL import Image, ImageDraw

    picture = Image.new("RGB", (512, 512), (240, 236, 228))
    draw = ImageDraw.Draw(picture)
    draw.ellipse((96, 96, 288, 288), fill=(220, 80, 60))
    draw.rectangle((256, 300, 448, 420), fill=(40, 90, 160))
    return picture


def run_graph(graph: dict) -> list[dict]:
    """Queues `graph` on ComfyUI and waits for it; the files its SaveImage node wrote."""
    body = json.dumps({"prompt": graph, "client_id": APP_NAME}).encode()
    queued = urllib.request.Request(f"{COMFYUI_URL}/prompt", data=body, headers={"content-type": "application/json"})
    try:
        with urllib.request.urlopen(queued, timeout=QUEUE_TIMEOUT_S) as answer:
            prompt_id = json.load(answer)["prompt_id"]
    except urllib.error.HTTPError as error:
        raise RuntimeError(f"ComfyUI refused the graph: {error.read().decode()[:2000]}") from error
    until = time.monotonic() + SPLIT_TIMEOUT_S
    while time.monotonic() < until:
        with urllib.request.urlopen(f"{COMFYUI_URL}/history/{prompt_id}", timeout=30) as answer:
            entry = json.load(answer).get(prompt_id)
        if entry and entry["status"].get("completed"):
            return entry["outputs"]["saved"]["images"]
        if entry and entry["status"].get("status_str") == "error":
            raise RuntimeError(f"ComfyUI failed the graph: {json.dumps(entry['status'].get('messages'))[:2000]}")
        time.sleep(0.1)
    raise RuntimeError("ComfyUI did not finish the graph in time")


def cut_pieces(picture, parts: list[Part], layers: list[Layer]) -> dict | None:
    """The split pieces of `picture` by its planned `parts`, cut from `layers`, as the contract's `pieces` holds
    them; None when they can't be cut, with why printed, so the call still gives its layers."""
    import numpy as np
    from PIL import Image

    from pieces import make_pieces

    try:
        arrays = [
            np.asarray(Image.open(io.BytesIO(base64.b64decode(layer.png))).convert("RGBA")).astype(np.float32) / 255
            for layer in layers
        ]
        return make_pieces(picture, [part.model_dump(mode="json") for part in parts], arrays)
    except Exception:
        traceback.print_exc()
        return None


def read_layer(file: dict) -> Layer:
    """One layer ComfyUI saved, as the contract carries it; the file is deleted once read."""
    from PIL import Image

    path = COMFYUI / file["type"] / file["subfolder"] / file["filename"]
    data = path.read_bytes()
    path.unlink()
    with Image.open(io.BytesIO(data)) as png:
        width, height = png.size
    return Layer(png=base64.b64encode(data).decode(), width=width, height=height)
