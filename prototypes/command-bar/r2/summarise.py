"""PROTOTYPE, never merged. One line of scores per result file of score_needle.py: exact outcome
(the call the model meant; and the engine's call after its repair step), actions, refusals, the
router's area when there are two turns, and exact by style of request.

  python summarise.py results/r2/free-*.jsonl
"""
import json
import sys

from outcomes import NONE


def summarise(path):
    rows = [json.loads(l) for l in open(path, encoding="utf-8")]
    acts = [r for r in rows if r["cls"] != NONE]
    nos = [r for r in rows if r["cls"] == NONE]
    out = {"file": path.split("/")[-1], "n": len(rows),
           "exact": sum(r["exact"] for r in rows) / len(rows),
           "exact_engine": sum(r["exact_engine"] for r in rows) / len(rows),
           "actions": sum(r["exact"] for r in acts) / max(len(acts), 1),
           "refusals": sum(r["exact"] for r in nos) / max(len(nos), 1)}
    styles = {}
    for r in rows:
        styles.setdefault(r.get("style"), []).append(r["exact"])
    out["by_style"] = {k: round(sum(v) / len(v), 3) for k, v in styles.items()}
    ms = sorted(((r.get("r1") or {}).get("ms", 0) + ((r.get("r2") or {}).get("ms", 0))) for r in rows)
    out["ms_median_shared_cpu"] = ms[len(ms) // 2]
    return out


if __name__ == "__main__":
    for p in sys.argv[1:]:
        s = summarise(p)
        print(json.dumps({k: (round(v, 4) if isinstance(v, float) else v) for k, v in s.items()}))
