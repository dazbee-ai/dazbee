"""PROTOTYPE, never merged. Writes .cact archives at every depth, as `cactus build` does, without
fetching the published archive on every run.

  python export_cact.py --out models/base --depths 2-20
  python export_cact.py --lora runs/r16/best.safetensors --out models/r16 --depths 2-20
  python export_cact.py --lora ... --head runs/head/head.safetensors --out models/r16h --depths 20

A LoRA archive drops the base confidence head (it was trained for other weights) unless --head
gives one trained for these; --keep-base-head keeps the base one, for comparison only.
"""
import argparse
import os

import numpy as np


def depths_of(text):
    out = []
    for part in text.split(","):
        if "-" in part:
            a, b = part.split("-")
            out += list(range(int(a), int(b) + 1))
        else:
            out.append(int(part))
    return out


def base_archive():
    from cactus.agent import fetch
    return fetch.fetch_weights(3)


def load_params(checkpoint, lora=None, head=None, keep_base_head=False):
    import jax.numpy as jnp
    from cactus.model.architecture import ConfidenceHead
    from cactus.model.checkpoints import read_adapter, read_checkpoint, unflatten
    from cactus.model.finetune import merge_lora
    from cactus.model.run import load_checkpoint

    params, config = load_checkpoint(checkpoint)
    if lora:
        adapter = read_adapter(lora)
        tree = {tuple(k.split("/")): {"A": jnp.asarray(v["A"]), "B": jnp.asarray(v["B"])}
                for k, v in adapter["lora"].items()}
        params = merge_lora(params, tree, adapter["scale"])
        if not keep_base_head:
            params = {k: v for k, v in params.items() if k != ConfidenceHead.key}
    if head:
        from safetensors.numpy import load_file
        params = dict(params)
        params[ConfidenceHead.key] = unflatten(load_file(head))
    return params, config


def export(params, config, depth, path, tokenizer_blob):
    from cactus.model.architecture import effective_kv_window
    from cactus.model.export import write_export
    from cactus.model.finetune import rung
    from cactus.model.quantize import WEIGHT_BITS

    p, c = rung(params, config, depth)
    info = write_export(p, c, path, bits=WEIGHT_BITS, tokenizer=tokenizer_blob,
                        kv_window=effective_kv_window(c))
    return info


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--checkpoint", default="checkpoints/needle3.safetensors")
    ap.add_argument("--lora")
    ap.add_argument("--head")
    ap.add_argument("--keep-base-head", action="store_true")
    ap.add_argument("--out", required=True)
    ap.add_argument("--depths", default="20")
    args = ap.parse_args()

    from cactus.model.export import read_tokenizer_blob
    blob = read_tokenizer_blob(base_archive())
    params, config = load_params(args.checkpoint, args.lora, args.head, args.keep_base_head)
    os.makedirs(args.out, exist_ok=True)
    for d in depths_of(args.depths):
        path = os.path.join(args.out, f"L{d:02d}.cact")
        info = export(params, config, d, path, blob)
        print(f"wrote {path} {info['bytes'] / 1e6:.1f} MB", flush=True)


if __name__ == "__main__":
    main()
