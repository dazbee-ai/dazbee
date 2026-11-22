"""PROTOTYPE, never merged. Scores the classes the WebAssembly run wrote (bench_wasm.mjs) on the
frozen test set, with the same value rule and exact check as export_eval.py.

  python score_wasm.py <classes .jsonl>
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from outcomes import DEFAULTS, NONE, read_test  # noqa: E402
from slots import value_for  # noqa: E402

gold = {r["query"]: r for r in read_test()}
rows = [json.loads(l) for l in open(sys.argv[1], encoding="utf-8")]
hits = 0
for p in rows:
    g = gold[p["query"]]
    ok = p["pred"] == g["cls"]
    if ok and g["cls"] != NONE:
        v = value_for(p["query"], p["pred"])
        ok = (v if v is not None else DEFAULTS.get(g["cls"])) == (g["value"] if g["value"] is not None else DEFAULTS.get(g["cls"]))
    hits += ok
print(json.dumps({"n": len(rows), "exact_wasm": round(hits / len(rows), 4)}))
