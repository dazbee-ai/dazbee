"""PROTOTYPE. The hand-written fingerprint the trained model is measured against: 47 numbers per line
strip that a type designer would read (ink per row, stroke thickness across and down and their
contrast, slant, ink density, edge busyness, width), compared by nearest class mean like the model.

    python train/handcrafted.py --val .data/samples/val6 --proto .data/samples/proto8
"""

import argparse
import json

import numpy as np

from train import load


def features(strip, width):
    x = strip[:, :width].astype(np.float32) / 255
    on = x > 0.5
    rows = x.mean(axis=1)
    rows = rows / (rows.max() + 1e-6)

    def runs(a):
        # Mean length of ink runs along the last axis.
        d = np.diff(np.pad(a.astype(np.int8), ((0, 0), (1, 1))), axis=1)
        starts, ends = np.where(d == 1), np.where(d == -1)
        n = len(starts[0])
        return (ends[1].sum() - starts[1].sum()) / n if n else 0.0

    across = runs(on)
    down = runs(on.T)
    best, slant = -1.0, 0.0
    for s in np.linspace(-0.4, 0.4, 17):
        shift = (np.arange(32) - 16) * s
        cols = np.zeros(width + 40)
        for y in range(32):
            idx = (np.arange(width) + 20 + shift[y]).astype(int)
            np.add.at(cols, idx, x[y])
        v = cols.var()
        if v > best:
            best, slant = v, s
    edges = np.abs(np.diff(on.astype(np.int8), axis=1)).sum() / (on.sum() + 1)
    return np.concatenate(
        [rows, [across / 32, down / 32, across / (down + 1e-6), slant, x.mean(), edges, width / 320, on[:, ::2].mean()],
         np.histogram(x[x > 0.05], bins=7, range=(0, 1))[0] / (np.count_nonzero(x > 0.05) + 1)]
    )


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--val", required=True)
    p.add_argument("--proto", required=True)
    a = p.parse_args()
    pmeta, ps, pw, pl = load(a.proto)
    _, vs, vw, vl = load(a.val)
    faces = pmeta["faces"]
    pf = np.stack([features(s, w) for s, w in zip(ps, pw)])
    vf = np.stack([features(s, w) for s, w in zip(vs, vw)])
    mu, sd = pf.mean(0), pf.std(0) + 1e-6
    pf, vf = (pf - mu) / sd, (vf - mu) / sd
    means = np.zeros((len(faces), pf.shape[1]))
    np.add.at(means, pl, pf)
    counts = np.bincount(pl, minlength=len(faces))[:, None]
    means = means / np.maximum(counts, 1)
    dist = ((vf[:, None, :] - means[None]) ** 2).sum(-1)
    dist[:, counts[:, 0] == 0] = np.inf
    order = dist.argsort(1)
    family = np.array([f.split("|")[0] for f in faces])
    res = {}
    for k in (1, 5, 25):
        res[f"face_top{k}"] = float(np.mean([vl[i] in order[i, :k] for i in range(len(vl))]))
        res[f"family_top{k}"] = float(np.mean([family[vl[i]] in set(family[order[i, :k]]) for i in range(len(vl))]))
    print(json.dumps(res))


if __name__ == "__main__":
    main()
