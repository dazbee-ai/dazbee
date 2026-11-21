"""PROTOTYPE. Finds novelty faces whose letters are drawn inside a pattern (a grid of squares, stripes, a
filled box) rather than as strokes, from each face's probe (src/face-probes.ts): such a face fills most
of its text's box with ink, or draws ink rows that run unbroken across many letters. Latin probes only:
Devanagari's headline joins a whole word on purpose.

    python train/novelty.py --probes samples/lib-probes [--coverage 0.55 --run 0.6] [--out novelty.json]
Prints the measures' spread and the faces past the thresholds; writes their ids to --out.
"""

import argparse
import json
import os

import numpy as np


def measures(probe):
    ink = probe > 127
    ys, xs = np.where(ink)
    if len(xs) == 0:
        return 0.0, 0.0, 1.0, 0.0
    box = ink[ys.min() : ys.max() + 1, xs.min() : xs.max() + 1]
    coverage = float(box.mean())
    longest = 0
    for row in box:
        # The longest unbroken run of ink in the row.
        d = np.diff(np.concatenate([[0], row.astype(np.int8), [0]]))
        starts, ends = np.where(d == 1)[0], np.where(d == -1)[0]
        if len(starts):
            longest = max(longest, int((ends - starts).max()))
    # Columns with no ink: the gaps between letters, which strokes leave and a pattern fills.
    gaps = float((~box.any(axis=0)).mean())
    # Faint ink 3 px or more from any solid ink: a pattern's fill, where a stroke's soft edge never reaches.
    # Solid ink relative to the face's own darkest ink, so hairline weights' strokes count as strokes.
    near = probe > 0.5 * np.percentile(probe[probe > 10], 98) if (probe > 10).any() else ink.copy()
    for _ in range(3):
        grown = near.copy()
        grown[1:] |= near[:-1]
        grown[:-1] |= near[1:]
        grown[:, 1:] |= near[:, :-1]
        grown[:, :-1] |= near[:, 1:]
        near = grown
    faint = (probe > 10) & ~near
    far = float(faint[ys.min() : ys.max() + 1, xs.min() : xs.max() + 1].mean())
    return coverage, longest / box.shape[1], gaps, far


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--probes", required=True)
    p.add_argument("--coverage", type=float, default=0.55)
    p.add_argument("--run", type=float, default=0.9)
    p.add_argument("--gap", type=float, default=0.002)
    p.add_argument("--far", type=float, default=0.05)
    p.add_argument("--out")
    a = p.parse_args()
    meta = json.load(open(os.path.join(a.probes, "meta.json")))
    probes = np.fromfile(os.path.join(a.probes, "probes.u8"), dtype=np.uint8).reshape(len(meta["faces"]), meta["height"], meta["width"])
    rows = []
    for f, s, pr in zip(meta["faces"], meta["scripts"], probes):
        if s != "latin":
            continue
        c, r, g, fa = measures(pr)
        rows.append((f, c, r, g, fa))
    cov = np.array([r[1] for r in rows])
    run = np.array([r[2] for r in rows])
    print("coverage percentiles 50/90/99/99.9:", np.percentile(cov, [50, 90, 99, 99.9]).round(3).tolist())
    print("longest run percentiles 50/90/99/99.9:", np.percentile(run, [50, 90, 99, 99.9]).round(3).tolist())
    gap = np.array([r[3] for r in rows])
    print("gap percentiles 0.1/1/10/50:", np.percentile(gap, [0.1, 1, 10, 50]).round(3).tolist())
    far = np.array([r[4] for r in rows])
    print("far faint percentiles 50/90/99/99.9:", np.percentile(far, [50, 90, 99, 99.9]).round(4).tolist())
    print("most far faint:", [(f, round(fa, 3)) for f, c, r, g, fa in sorted(rows, key=lambda r: -r[4])[:40]])
    print("no gaps and long runs:", [(f, round(r, 2), round(c, 2)) for f, c, r, g, fa in rows if g <= a.gap and r >= a.run])
    out = [f for f, c, r, g, fa in rows if fa >= a.far or (g <= a.gap and r >= a.run)]
    print(len(out), "faces past the thresholds,", len({f.split("|")[0] for f in out}), "families:", sorted({f.split("|")[0] for f in out}))
    if a.out:
        json.dump(out, open(a.out, "w"), indent=1)


if __name__ == "__main__":
    main()
