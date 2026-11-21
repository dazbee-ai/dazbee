"""PROTOTYPE, never merged. Builds the report's tables from score.py results.

  python report_tables.py --results ../results --out reports/tables.md

Reads every <model>-L<depth>-<split>.jsonl (and <model>-published-<split>.jsonl), and writes one
table per model of every depth, plus a JSON of the same numbers next to it.
"""
import argparse
import glob
import json
import os
import re

from metrics import evaluate, load


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--results", required=True)
    ap.add_argument("--split", default="test")
    ap.add_argument("--conf", default="min")
    ap.add_argument("--threshold", type=float, default=0.5)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    rows = {}
    for path in sorted(glob.glob(os.path.join(args.results, f"*-{args.split}.jsonl"))):
        m = re.match(rf"(.+)-(L\d\d|published)-{args.split}\.jsonl$", os.path.basename(path))
        if not m:
            continue
        model, depth = m.groups()
        rows.setdefault(model, {})[depth] = evaluate(load(path), args.conf, args.threshold)
    lines = []
    for model, depths in rows.items():
        lines += [f"### {model} ({args.split}, {next(iter(depths.values()))['n']} requests)", "",
                  "| depth | exact | exact on-topic | refused off-topic | router right | AUROC | ECE | ms mean | ms p95 |",
                  "|---|---|---|---|---|---|---|---|---|"]
        for depth in sorted(depths, key=lambda d: (d != "published", d), reverse=True):
            e = depths[depth]
            lines.append(f"| {depth} | {e['exact']:.3f} | {e['exact_on_topic']:.3f} | {e['refused_off_topic']:.3f} | "
                         f"{e['router_on_topic']:.3f} | {e['auroc']:.3f} | {e['ece']:.3f} | "
                         f"{e['ms_mean']:.0f} | {e['ms_p95']:.0f} |")
        lines.append("")
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    with open(os.path.splitext(args.out)[0] + ".json", "w", encoding="utf-8") as f:
        json.dump(rows, f, indent=1)
    print("\n".join(lines))


if __name__ == "__main__":
    main()
