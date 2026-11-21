"""PROTOTYPE, never merged. How far agreement can stand in for confidence: two tuned models
(LoRA rank 16 and rank 32) reading the same request, and the other areas' turn two refusing.

  python agreement.py results/r16-head-L20-validation-every.jsonl results/r32-L20-validation-every.jsonl

For each rule, the share of requests the bar would act on and the wrong share of those actions.
"""
import json
import sys

from metrics import canon, confidence, final_call, load
from model_call import turn_call
from tools import ACTIONS


def others_claim(row):
    """How many areas other than the picked one also wrote a call in turn two."""
    from metrics import _turns
    _, _, area = _turns(row)
    n = 0
    for a, t in (row.get("others") or {}).items():
        if a != area and turn_call(t, ACTIONS[a]):
            n += 1
    if row.get("r2") and row["r1"]["calls"] and row["r1"]["calls"][0]["name"] != area:
        if turn_call(row["r2"], ACTIONS[row["r1"]["calls"][0]["name"]]):
            n += 1
    return n


def rules(a_rows, b_rows):
    out = []
    by_q = {r["query"]: r for r in b_rows}
    pairs = [(r, by_q[r["query"]]) for r in a_rows if r["query"] in by_q]
    n = len(pairs)

    def report(name, act):
        acted = [(r, final_call(r)) for (r, b) in pairs if act(r, b)]
        wrong = sum(1 for r, c in acted if canon(c) != canon(r["answers"]))
        out.append({"rule": name, "acted_rate": len(acted) / n, "acted": len(acted), "wrong": wrong,
                    "wrong_rate": wrong / max(1, len(acted))})

    agree = lambda r, b: bool(final_call(r)) and canon(final_call(r)) == canon(final_call(b))
    report("any call", lambda r, b: bool(final_call(r)))
    report("r16 and r32 agree", agree)
    report("agree, no other area claims it", lambda r, b: agree(r, b) and others_claim(r) == 0)
    for t in (0.5, 0.6, 0.7):
        report(f"agree, no other area, conf >= {t}",
               lambda r, b, t=t: agree(r, b) and others_claim(r) == 0 and confidence(r) >= t)
    return out


def main():
    a, b = load(sys.argv[1]), load(sys.argv[2])
    for row in rules(a, b):
        print(json.dumps(row))


if __name__ == "__main__":
    main()
