"""PROTOTYPE, never merged. Runs a benchmark command several times and reports the median and
spread of its request time, with what else the machine was busy with.

  python bench_repeat.py --repeats 3 --out reports/speed-envy-native.json -- \
      python bench_native.py --weights ../models/r16-head/L20.cact --threads 4 --n 100
"""
import argparse
import json
import os
import statistics
import subprocess
import sys


def load_note():
    try:
        out = subprocess.run(["sh", "-c", "uptime; top -bn1 | head -15 | tail -8"], capture_output=True,
                             text=True, timeout=20).stdout
    except Exception:
        out = ""
    return out.strip()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--repeats", type=int, default=3)
    ap.add_argument("--out", required=True)
    ap.add_argument("--note", default="")
    ap.add_argument("cmd", nargs=argparse.REMAINDER)
    args = ap.parse_args()
    cmd = args.cmd[1:] if args.cmd and args.cmd[0] == "--" else args.cmd
    runs = []
    for i in range(args.repeats):
        before = load_note()
        out = subprocess.run(cmd, capture_output=True, text=True).stdout.strip().splitlines()
        line = json.loads(out[-1])
        line["load_before"] = before
        runs.append(line)
        print(json.dumps({k: v for k, v in line.items() if k != "load_before"}), flush=True)

    def pick(r):
        return r["mean_ms"] if "mean_ms" in r else r["request_ms"]["mean"]

    def pick95(r):
        return r["p95_ms"] if "p95_ms" in r else r["request_ms"]["p95"]

    means = [pick(r) for r in runs]
    p95s = [pick95(r) for r in runs]
    summary = {"cmd": " ".join(cmd), "note": args.note, "repeats": len(runs),
               "mean_ms_median": statistics.median(means), "mean_ms_min": min(means), "mean_ms_max": max(means),
               "p95_ms_median": statistics.median(p95s), "runs": runs}
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, "w") as f:
        json.dump(summary, f, indent=1)
    print(json.dumps({k: v for k, v in summary.items() if k != "runs"}))


if __name__ == "__main__":
    sys.exit(main())
