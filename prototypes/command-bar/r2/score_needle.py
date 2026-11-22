"""PROTOTYPE, never merged. Runs round 2's frozen test set (or any queries file) through the real
Cactus engine with one of the schemas in schemas.py, and writes one line per request with the
call as the model meant it (its reasoning line, else the engine's call), turned into round 1's
form, and whether it is the gold outcome.

  python score_needle.py --weights models/r16/L20.cact --schema r1 --out results/r2/r16-r1.jsonl
  python score_needle.py --weights base --schema one ...      (base: the published 2-bit archive)
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
sys.path.insert(0, os.path.dirname(HERE))

from model_call import from_reasoning, valid  # noqa: E402
from outcomes import read_test, same  # noqa: E402
from schemas import SCHEMAS  # noqa: E402


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
    return {"calls": r.get("function_calls") or [], "held": r.get("suppressed_calls") or [],
            "conf": r.get("confidence"), "reasoning": r.get("reasoning"),
            "ms": round((time.perf_counter() - t) * 1000, 1)}


def meant(t, tools):
    """The turn's call as the model meant it: reasoning line if valid or a refusal, else the engine's."""
    if not t:
        return []
    r = from_reasoning(t.get("reasoning"))
    if r == []:
        return []
    if r and valid(r[0], tools):
        return r
    return t["calls"][:1]


def work(args, rows, out_path):
    import cactus
    cactus.set_threads(args.threads)
    s = SCHEMAS[args.schema]
    router = make_agent(s["router"], args.weights) if s["router"] else None
    areas = {a: make_agent(t, args.weights) for a, t in s["areas"].items()}
    with open(out_path, "w", encoding="utf-8") as f:
        for row in rows:
            out = dict(row)
            if router:
                r1 = turn(router, row["query"])
                route = meant(r1, s["router"])
                area = route[0]["name"] if route else None
                out["r1"] = r1
            else:
                area = "all"
            r2 = turn(areas[area], row["query"]) if area in areas else None
            call = meant(r2, s["areas"][area]) if r2 else []
            engine = (r2 or {}).get("calls", [])[:1]
            out.update(area=area, r2=r2, call=call, r1call=s["to_r1"](call[0]) if call else [],
                       engine_r1call=s["to_r1"](engine[0]) if engine else [])
            out["exact"] = same(row["answers"], out["r1call"]) if out["r1call"] or row["answers"] else True
            out["exact_engine"] = (same(row["answers"], out["engine_r1call"])
                                   if out["engine_r1call"] or row["answers"] else True)
            f.write(json.dumps(out, ensure_ascii=False) + "\n")
            f.flush()
    for a in ([router] if router else []) + list(areas.values()):
        a.close()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--weights", required=True)
    ap.add_argument("--schema", default="r1", choices=list(SCHEMAS))
    ap.add_argument("--queries", help="a .jsonl of rows with query and answers (default: the frozen test set)")
    ap.add_argument("--out", required=True)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--procs", type=int, default=4)
    ap.add_argument("--threads", type=int, default=4)
    args = ap.parse_args()
    rows = ([json.loads(l) for l in open(args.queries, encoding="utf-8")] if args.queries else read_test())
    if args.limit:
        rows = rows[:args.limit]
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    t = time.time()
    parts = [f"{args.out}.part{k}" for k in range(args.procs)]
    procs = [mp.Process(target=work, args=(args, rows[k::args.procs], parts[k])) for k in range(args.procs)]
    for p in procs:
        p.start()
    for p in procs:
        p.join()
    out = []
    for part in parts:
        out += [json.loads(l) for l in open(part, encoding="utf-8")]
        os.remove(part)
    with open(args.out + ".tmp", "w", encoding="utf-8") as f:
        for r in out:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    os.replace(args.out + ".tmp", args.out)
    n = len(out)
    ex = sum(r["exact"] for r in out) / n
    exe = sum(r["exact_engine"] for r in out) / n
    print(json.dumps({"weights": args.weights, "schema": args.schema, "n": n, "exact": round(ex, 4),
                      "exact_engine": round(exe, 4), "seconds": round(time.time() - t)}), flush=True)


if __name__ == "__main__":
    main()
