"""PROTOTYPE, never merged. Times Needle on the native engine, one request at a time, with a
schema of schemas.py: the one-turn schema is one engine and one turn; two-turn schemas are the
router plus five area engines and two turns. Requests from the frozen test set.

  python bench_needle.py --weights models/x/L20.cact --schema one --threads 4 --n 100
"""
import argparse
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from outcomes import read_test  # noqa: E402
from schemas import SCHEMAS  # noqa: E402
from score_needle import make_agent  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--weights", required=True)
    ap.add_argument("--schema", default="one")
    ap.add_argument("--threads", type=int, default=4)
    ap.add_argument("--n", type=int, default=100)
    args = ap.parse_args()
    import cactus
    cactus.set_threads(args.threads)
    s = SCHEMAS[args.schema]
    t = time.perf_counter()
    router = make_agent(s["router"], args.weights) if s["router"] else None
    areas = {a: make_agent(tl, args.weights) for a, tl in s["areas"].items()}
    for a in ([router] if router else []) + list(areas.values()):
        a.complete("warm up")
    setup = time.perf_counter() - t
    ms, ram = [], 0
    for r in read_test()[:args.n]:
        t = time.perf_counter()
        resps = []
        if router:
            r1 = router.complete(r["query"], max_new_tokens=160)
            resps.append(r1)
            calls = r1.get("function_calls") or []
            if calls and calls[0]["name"] in areas:
                resps.append(areas[calls[0]["name"]].complete(r["query"], max_new_tokens=160))
        else:
            resps.append(areas["all"].complete(r["query"], max_new_tokens=160))
        ms.append((time.perf_counter() - t) * 1000)
        ram = max([ram] + [x.get("peak_ram_mb") or 0 for x in resps])
    ms.sort()
    print(json.dumps({"weights": args.weights, "schema": args.schema, "engines": len(areas) + bool(router),
                      "threads": args.threads, "requests": len(ms), "setup_s": round(setup, 1),
                      "p50_ms": round(ms[len(ms) // 2]), "p95_ms": round(ms[int(len(ms) * 0.95)]),
                      "peak_ram_mb_per_engine": ram}))
    for a in ([router] if router else []) + list(areas.values()):
        a.close()


if __name__ == "__main__":
    main()
