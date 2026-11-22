"""PROTOTYPE, never merged. Needle training rows for round 2, in a schema of schemas.py, from the
same requests every model trains on (clf/data.py). Each row holds exactly what the engine is sent
for that turn (the same tools, in the same order) and the target the model should write: a short
reasoning line naming the call, then the call.

  python needle_rows.py --schema one       -> data/needle-one-{train,validation}.jsonl
                                              and data/val-queries.jsonl (engine checkpoint picks)
Two-turn schemas also get the router turn, and for 35% of requests a turn with a wrong area's
tools and no call, as in round 1.
"""
import argparse
import json
import os
import random
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "clf"))
sys.path.insert(0, os.path.dirname(HERE))

from data import load  # noqa: E402
from gen_data import REFUSE, reasoning  # noqa: E402
from outcomes import NONE, call_of  # noqa: E402
from schemas import SCHEMAS  # noqa: E402


def rows_for(reqs, schema, rng, misroute=0.35):
    s = SCHEMAS[schema]
    out = []
    for r in reqs:
        gold = call_of(r["cls"], r["value"])
        call = s["from_r1"](gold[0]) if gold else None
        if s["router"] is None:
            tools = s["areas"]["all"]
            out.append({"query": r["query"], "tools": tools, "answers": [call] if call else [],
                        "reasoning": reasoning(call)})
            continue
        area = s["area_of"][call["name"]] if call else None
        route = {"name": area, "arguments": {}} if area else None
        out.append({"query": r["query"], "tools": s["router"], "answers": [route] if route else [],
                    "reasoning": reasoning(route)})
        if area:
            out.append({"query": r["query"], "tools": s["areas"][area], "answers": [call],
                        "reasoning": reasoning(call)})
        if rng.random() < misroute:
            other = rng.choice([a for a in s["areas"] if a != area])
            out.append({"query": r["query"], "tools": s["areas"][other], "answers": [], "reasoning": REFUSE})
    rng.shuffle(out)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--schema", default="one", choices=list(SCHEMAS))
    ap.add_argument("--val-queries", type=int, default=800, help="validation requests the engine scores")
    args = ap.parse_args()
    train, val = load()
    rng = random.Random(0)
    d = os.path.join(HERE, "data")
    for split, reqs in (("train", train), ("validation", val)):
        rows = rows_for(reqs, args.schema, rng)
        with open(os.path.join(d, f"needle-{args.schema}-{split}.jsonl"), "w", encoding="utf-8") as f:
            for r in rows:
                f.write(json.dumps(r, ensure_ascii=False, separators=(",", ":")) + "\n")
        print(split, len(reqs), "requests", len(rows), "rows")
    pick = random.Random(1).sample(val, min(args.val_queries, len(val)))
    with open(os.path.join(d, "val-queries.jsonl"), "w", encoding="utf-8") as f:
        for r in pick:
            f.write(json.dumps({"query": r["query"], "cls": r["cls"], "value": r["value"],
                                "answers": call_of(r["cls"], r["value"]),
                                "category": r["category"], "style": r["source"]}, ensure_ascii=False) + "\n")
    print("val queries", len(pick), "none", sum(r["cls"] == NONE for r in pick))


if __name__ == "__main__":
    main()
