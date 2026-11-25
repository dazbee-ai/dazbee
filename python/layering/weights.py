"""Ming's weights as Comfy-Org repackaged them for ComfyUI, at a fixed commit, and where ComfyUI finds them.

`download` runs once, as a step of the app image's build, apart from the app's other modules.
"""

from pathlib import Path

COMFYUI = Path("/comfyui")

REPO = "Comfy-Org/Ming-Image"
REVISION = "93804ff3747517a318969c5f61b25a57daefe09f"

DIFFUSION_MODEL = "ming_image_0.1_design_layer_bf16.safetensors"
TEXT_ENCODER = "ming_image_0.1_ling_mini_2.0_layer_int8_convrot.safetensors"
VAE = "ming_image_vae_bf16.safetensors"

# Each file by the folder of ComfyUI's models it goes in, which is also its folder in the repo.
FILES = {"diffusion_models": DIFFUSION_MODEL, "text_encoders": TEXT_ENCODER, "vae": VAE}


def download() -> None:
    """Puts each file in its folder of ComfyUI's models."""
    import shutil

    from huggingface_hub import hf_hub_download

    for folder, name in FILES.items():
        path = hf_hub_download(REPO, f"{folder}/{name}", revision=REVISION, local_dir="/weights")
        target = COMFYUI / "models" / folder / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(path, target)
    shutil.rmtree("/weights", ignore_errors=True)
