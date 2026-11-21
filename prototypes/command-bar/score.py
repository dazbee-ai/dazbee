"""PROTOTYPE, never merged. Runs requests through the real Cactus engine, two turns each, and
writes one result line per request.

  python score.py --weights models/r16/L20.cact --split test --out results/r16-L20-test.jsonl
  python score.py --weights base --split test ...     (the published needle3.cact)

Turn one offers the five areas; turn two the picked area's tools. The engine's own confidence is
kept for both turns, also for weights without a head of their own (then it is the decode
probability alone; the Python wrapper would report None).
"""
import argparse
import json
import multiprocessing as mp
import os
import sys
import time

os.environ.setdefault("CACTUS_TELEMETRY", "0")
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from tools import ACTIONS, AREAS  # noqa: E402


def make_agent(tools, weights):
    import warnings
    import cactus
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        agent = cactus.Cactus(tools=tools, weights=None if weights == "base" else weights,
                              stateless=True, auto_date=False)
    agent._calibrated = True
    return agent


def turn(agent, query):
    t = time.perf_counter()
    r = agent.complete(query, max_new_tokens=160)
    ms = (time.perf_counter() - t) * 1000
    return {"calls": r.get("function_calls") or [], "held": r.get("suppressed_calls") or [],
            "conf": r.get("confidence"), "reasoning": r.get("reasoning"), "ms": round(ms, 1),
            "decode_tps": r.get("decode_tps"), "prefill_tps": r.get("prefill_tps"),
            "ram": r.get("peak_ram_mb"), "ungrounded": (r.get("validation") or {}).get("ungrounded")}


def work(args, rows, shard, out_path):
    import cactus
    cactus.set_threads(args.threads)
    router = make_agent(AREAS, args.weights)
    areas = {a: make_agent(t, args.weights) for a, t in ACTIONS.items()}
    with open(out_path, "w", encoding="utf-8") as f:
        for i, row in enumerate(rows):
            r1 = turn(router, row["query"])
            area = r1["calls"][0]["name"] if r1["calls"] else None
            r2 = turn(areas[area], row["query"]) if area in areas else None
            extra = {}
            if args.every_area:
                # Turn two with each other area's tools too: the head's examples of misroutes.
                extra["others"] = {a: turn(ag, row["query"]) for a, ag in areas.items() if a != area}
            f.write(json.dumps({**row, "r1": r1, "r2": r2, **extra}, ensure_ascii=False) + "\n")
            f.flush()
    for a in [router, *areas.values()]:
        a.close()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--weights", required=True)
    ap.add_argument("--split", default="test")
    ap.add_argument("--queries", help="a queries.jsonl file instead of --split")
    ap.add_argument("--out", required=True)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--procs", type=int, default=4)
    ap.add_argument("--threads", type=int, default=4)
    ap.add_argument("--every-area", action="store_true")
    args = ap.parse_args()
    path = args.queries or os.path.join(HERE, "data", f"{args.split}.queries.jsonl")
    rows = [json.loads(line) for line in open(path, encoding="utf-8")]
    if args.limit:
        rows = rows[:args.limit]
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    t = time.time()
    parts = [f"{args.out}.part{k}" for k in range(args.procs)]
    procs = [mp.Process(target=work, args=(args, rows[k::args.procs], k, parts[k]))
             for k in range(args.procs)]
    for p in procs:
        p.start()
    for p in procs:
        p.join()
    with open(args.out, "w", encoding="utf-8") as f:
        for part in parts:
            for line in open(part, encoding="utf-8"):
                f.write(line)
            os.remove(part)
    print(f"scored {len(rows)} in {time.time() - t:.0f}s -> {args.out}", flush=True)


if __name__ == "__main__":
    main()
