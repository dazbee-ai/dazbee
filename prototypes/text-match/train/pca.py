"""PROTOTYPE. Fewer fingerprint numbers: the face fingerprints' principal directions (fitted on the
gallery itself), kept as pca-<k>.f32 (the 512 means, then the 512×k directions) beside the model, and
the gallery projected onto them as fingerprints-pca<k>.f32. The matcher projects a block's fingerprint
the same way when FP_PCA=<k> (src/fingerprint.ts).

    python train/pca.py --model models/r3l-convnext_atto --k 128
"""

import argparse
import json
import os
import shutil

import numpy as np


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--model", required=True)
    p.add_argument("--k", type=int, default=128)
    a = p.parse_args()
    dim = json.load(open(os.path.join(a.model, "model.json")))["dim"]
    g = np.fromfile(os.path.join(a.model, "fingerprints.f32"), dtype=np.float32).reshape(-1, dim).astype(np.float64)
    mean = g.mean(0)
    _, _, vt = np.linalg.svd(g - mean, full_matrices=False)
    proj = vt[: a.k].T
    out = (g - mean) @ proj
    out /= np.linalg.norm(out, axis=1, keepdims=True)
    np.concatenate([mean, proj.ravel()]).astype(np.float32).tofile(os.path.join(a.model, f"pca-{a.k}.f32"))
    out.astype(np.float32).tofile(os.path.join(a.model, f"fingerprints-pca{a.k}.f32"))
    shutil.copy(os.path.join(a.model, "fingerprint-faces.json"), os.path.join(a.model, f"fingerprint-faces-pca{a.k}.json"))
    print(f"{len(g)} faces: {dim} to {a.k} numbers, {os.path.getsize(os.path.join(a.model, f'fingerprints-pca{a.k}.f32'))} bytes")


if __name__ == "__main__":
    main()
