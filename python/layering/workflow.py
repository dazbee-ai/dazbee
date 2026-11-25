"""The layer split's ComfyUI graph, in ComfyUI's API format, and the numbers it is built from.

The graph follows Ming-Image-0.1-Design-Layer's own pipeline (github.com/inclusionAI/Ming-Image): the picture
at a working size of about `size` x `size` pixels that keeps its aspect ratio, a latent of the composite and
one frame per layer, 12 steps of euler on the simple schedule, and the pipeline's shift for that size. The
layers are cut from the latent, decoded one by one by the RGBA VAE and saved as PNGs.
"""

import math
import re

from weights import DIFFUSION_MODEL, TEXT_ENCODER, VAE

STEPS = 12
DEFAULT_LAYERS = 5
SEED = 0

# The working size's sides are whole multiples of this: the VAE's 8 times the DiT's patch of 2.
SIDE_STEP = 16


def working_size(width: int, height: int, size: int) -> tuple[int, int]:
    """The picture's size scaled to about `size` x `size` pixels, its sides whole multiples of 16."""
    scale = size / math.sqrt(width * height)
    return (
        max(SIDE_STEP, round(width * scale / SIDE_STEP) * SIDE_STEP),
        max(SIDE_STEP, round(height * scale / SIDE_STEP) * SIDE_STEP),
    )


def layer_count(plan: str) -> int:
    """How many layers `plan` asks for, read as Ming's pipeline reads it; 5 when it says no number."""
    match = re.search(r"decompose this image into\s+(\d+)\s+layers?", plan.lower())
    if match:
        return int(match.group(1))
    for line in plan.splitlines():
        text = line.strip().lower()
        if text.startswith("number of layers:"):
            try:
                return int(text.split(":", 1)[1].strip())
            except ValueError:
                pass
    return DEFAULT_LAYERS


def default_plan() -> str:
    """The plan of a call that gives none: Ming's own default request."""
    return f"Decompose this image into {DEFAULT_LAYERS} layers."


def shift(width: int, height: int) -> float:
    """The flow shift Ming's pipeline takes for a working size: exp(mu) of its dynamic shift (3.86 at 1024 px)."""
    tokens = (width // SIDE_STEP) * (height // SIDE_STEP)
    max_tokens, max_shift = (tokens, 1.35) if tokens >= 4096 else (4096, 1.15)
    slope = (max_shift - 0.5) / (max_tokens - 256)
    return math.exp(tokens * slope + 0.5 - slope * 256)


def layer_split_graph(
    picture: str,
    width: int,
    height: int,
    plan: str,
    guidance: float | None,
    steps: int = STEPS,
) -> dict:
    """The ComfyUI prompt that splits the input picture `picture`, already at its working size, into layers.

    With no guidance it runs unguided (cfg 1), which ComfyUI runs without the negative pass.
    """
    layers = layer_count(plan)
    return {
        "unet": {"class_type": "UNETLoader", "inputs": {"unet_name": DIFFUSION_MODEL, "weight_dtype": "fp8_e4m3fn"}},
        "clip": {"class_type": "CLIPLoader", "inputs": {"clip_name": TEXT_ENCODER, "type": "qwen_image"}},
        "vae": {"class_type": "VAELoader", "inputs": {"vae_name": VAE}},
        "picture": {"class_type": "LoadImage", "inputs": {"image": picture}},
        "shifted": {
            "class_type": "ModelSamplingAuraFlow",
            "inputs": {"model": ["unet", 0], "shift": round(shift(width, height), 4)},
        },
        "positive": {
            "class_type": "TextEncodeMingImageEdit",
            "inputs": {"clip": ["clip", 0], "vae": ["vae", 0], "prompt": plan, "images.image_1": ["picture", 0]},
        },
        "negative": {
            "class_type": "TextEncodeMingImageEdit",
            "inputs": {"clip": ["clip", 0], "vae": ["vae", 0], "prompt": "", "images.image_1": ["picture", 0]},
        },
        "latent": {
            "class_type": "EmptyQwenImageLayeredLatentImage",
            "inputs": {"width": width, "height": height, "layers": layers, "batch_size": 1},
        },
        "sampled": {
            "class_type": "KSampler",
            "inputs": {
                "model": ["shifted", 0],
                "positive": ["positive", 0],
                "negative": ["negative", 0],
                "latent_image": ["latent", 0],
                "seed": SEED,
                "steps": steps,
                "cfg": guidance if guidance is not None else 1.0,
                "sampler_name": "euler",
                "scheduler": "simple",
                "denoise": 1.0,
            },
        },
        # The first frame is the composite; the rest are the layers, top first.
        "layers": {
            "class_type": "LatentCut",
            "inputs": {"samples": ["sampled", 0], "dim": "t", "index": 1, "amount": layers},
        },
        "batch": {"class_type": "LatentCutToBatch", "inputs": {"samples": ["layers", 0], "dim": "t", "slice_size": 1}},
        "decoded": {"class_type": "VAEDecode", "inputs": {"samples": ["batch", 0], "vae": ["vae", 0]}},
        "saved": {"class_type": "SaveImage", "inputs": {"images": ["decoded", 0], "filename_prefix": "layers"}},
    }
