"""PROTOTYPE. Each face's fingerprint from a trained model, on the GPU: the mean over the face's samples
of each sample's mean window fingerprint, unit length; the same as src/build-fingerprints.ts does on the
CPU with the ONNX model, for when there are many faces.

    python train/fingerprints.py --model models/lib-w32-p48 --proto samples/lib-proto8
Writes <model>/fingerprints.f32 and <model>/fingerprint-faces.json.
"""

import argparse
import json
import os

import torch
import torch.nn.functional as F

from train import Fingerprint, embed_strips, load


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--model", required=True)
    p.add_argument("--proto", required=True)
    a = p.parse_args()
    args = json.load(open(os.path.join(a.model, "metrics.json")))["args"]
    dev = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model = Fingerprint(args["width"], args["dim"])
    model.load_state_dict(torch.load(os.path.join(a.model, "model.pt"), map_location="cpu"))
    model.to(dev).eval()
    meta, strips, widths, labels = load(a.proto)
    emb = embed_strips(model, strips, widths, dev)
    means = torch.zeros(len(meta["faces"]), emb.shape[1], device=dev).index_add_(0, torch.from_numpy(labels).to(dev), emb)
    means = F.normalize(means, dim=1).cpu().numpy().astype("float32")
    means.tofile(os.path.join(a.model, "fingerprints.f32"))
    json.dump(meta["faces"], open(os.path.join(a.model, "fingerprint-faces.json"), "w"))
    print(f"{len(meta['faces'])} fingerprints")


if __name__ == "__main__":
    main()
