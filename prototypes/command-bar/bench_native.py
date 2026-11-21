"""PROTOTYPE, never merged. Times the command bar on the native engine, one request at a time,
with nothing else running: both turns, as a person typing into the bar would wait for them.

  python bench_native.py --weights models/r16h/L20.cact --threads 4 --n 100
"""
import argparse
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from score import make_agent  # noqa: E402
from tools import ACTIONS, AREAS  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--weights", required=True)
    ap.add_argument("--threads", type=int, default=4)
    ap.add_argument("--n", type=int, default=100)
    args = ap.parse_args()
    import cactus
    cactus.set_threads(args.threads)
    t = time.perf_counter()
    router = make_agent(AREAS, args.weights)
    areas = {a: make_agent(tl, args.weights) for a, tl in ACTIONS.items()}
    router.complete("warm up")
    for a in areas.values():
        a.complete("warm up")
    setup = time.perf_counter() - t
    rows = [json.loads(l) for l in open(os.path.join(HERE, "data", "test.queries.jsonl"))][:args.n]
    ms, ram, pre, dec = [], 0, [], []
    for r in rows:
        t = time.perf_counter()
        r1 = router.complete(r["query"], max_new_tokens=160)
        resps = [r1]
        calls = r1.get("function_calls") or []
        if calls and calls[0]["name"] in areas:
            resps.append(areas[calls[0]["name"]].complete(r["query"], max_new_tokens=160))
        ms.append((time.perf_counter() - t) * 1000)
        for x in resps:
            ram = max(ram, x.get("peak_ram_mb") or 0)
            pre.append(x.get("prefill_tps") or 0)
            dec.append(x.get("decode_tps") or 0)
    ms.sort()
    print(json.dumps({"weights": os.path.basename(os.path.dirname(args.weights)) + "/" + os.path.basename(args.weights),
                      "bytes": os.path.getsize(args.weights) if os.path.exists(args.weights) else None,
                      "threads": args.threads, "requests": len(ms), "setup_s": round(setup, 1),
                      "mean_ms": round(sum(ms) / len(ms)), "p50_ms": round(ms[len(ms) // 2]),
                      "p95_ms": round(ms[int(len(ms) * 0.95)]), "peak_ram_mb_per_engine": ram,
                      "prefill_tps_mean": round(sum(pre) / len(pre)), "decode_tps_mean": round(sum(dec) / len(dec))}))
    for a in [router, *areas.values()]:
        a.close()


if __name__ == "__main__":
    main()
