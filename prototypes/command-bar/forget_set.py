"""PROTOTYPE, never merged. The forgetting check: general tool calls from public sets whose
licences allow commercial use, to see what tuning costs Needle outside our tools.

  google/mobile-actions (CC-BY-4.0): phone actions, the gold tools plus others, five at most
  NousResearch/hermes-function-calling-v1 (Apache-2.0): single-turn calls, five tools at most
  nvidia/When2Call (CC-BY-4.0): requests its tools can't serve, answered with no call

  python forget_set.py --root ../public --out data/forget.jsonl
  python forget_set.py --score --weights base --out results/forget-base.jsonl
"""
import argparse
import json
import os
import random
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)


def lower_types(schema):
    if isinstance(schema, dict):
        out = {}
        for k, v in schema.items():
            if k == "type" and isinstance(v, str):
                v = v.split(",")[0].strip()
                v = {"dict": "object", "str": "string", "int": "integer", "float": "number",
                     "bool": "boolean", "list": "array"}.get(v.lower(), v.lower())
            out[k] = lower_types(v)
        return out
    if isinstance(schema, list):
        return [lower_types(x) for x in schema]
    return schema


def clean_tool(t):
    t = t.get("function", t)
    params = lower_types(t.get("parameters") or {"type": "object", "properties": {}})
    params.setdefault("properties", {})
    return {"name": t["name"], "description": t.get("description", ""), "parameters": params}


def mobile(root, rng, n):
    rows = [json.loads(l) for l in open(os.path.join(root, "google__mobile-actions", "dataset.jsonl"))]
    rng.shuffle(rows)
    out = []
    for r in rows:
        msgs = r["messages"]
        user = [m for m in msgs if m["role"] == "user"]
        asst = [m for m in msgs if m["role"] == "assistant"]
        if len(user) != 1 or len(asst) != 1 or not asst[0].get("tool_calls"):
            continue
        calls = [{"name": c["function"]["name"], "arguments": c["function"]["arguments"]}
                 for c in asst[0]["tool_calls"]]
        tools = [clean_tool(t) for t in r["tools"]]
        gold = {c["name"] for c in calls}
        keep = [t for t in tools if t["name"] in gold]
        others = [t for t in tools if t["name"] not in gold]
        rng.shuffle(others)
        keep += others[:max(0, 5 - len(keep))]
        rng.shuffle(keep)
        if len(keep) > 5:
            continue
        out.append({"query": user[0]["content"], "tools": keep, "answers": calls, "source": "mobile-actions"})
        if len(out) >= n:
            break
    return out


def hermes(root, rng, n):
    rows = json.load(open(os.path.join(root, "NousResearch__hermes-function-calling-v1", "func-calling-singleturn.json")))
    rng.shuffle(rows)
    out = []
    for r in rows:
        conv = r["conversations"]
        sys_msg = next((c["value"] for c in conv if c["from"] == "system"), "")
        human = [c["value"] for c in conv if c["from"] == "human"]
        gpt = [c["value"] for c in conv if c["from"] == "gpt"]
        found = re.findall(r"<tools>\s*(.*?)\s*</tools>", sys_msg, re.S)
        m = max(found, key=len) if found else None
        if not m or len(human) != 1 or len(gpt) != 1 or len(human[0]) > 1500:
            continue
        try:
            tools = [clean_tool(t) for t in json.loads(m)]
            calls = [json.loads(x) for x in re.findall(r"<tool_call>\s*(.*?)\s*</tool_call>", gpt[0], re.S)]
        except (json.JSONDecodeError, KeyError):
            continue
        if not calls or len(tools) > 5 or len(calls) > 3:
            continue
        calls = [{"name": c["name"], "arguments": c.get("arguments", {})} for c in calls]
        out.append({"query": human[0], "tools": tools, "answers": calls, "source": "hermes"})
        if len(out) >= n:
            break
    return out


def when2call(root, rng, n):
    rows = [json.loads(l) for l in open(os.path.join(root, "nvidia__When2Call", "train", "when2call_train_sft.jsonl"))]
    rng.shuffle(rows)
    out = []
    for r in rows:
        try:
            tools = [clean_tool(json.loads(t)) for t in r["tools"]]
        except (json.JSONDecodeError, KeyError):
            continue
        if not tools or len(tools) > 5:
            continue
        out.append({"query": r["messages"][0]["content"], "tools": tools, "answers": [], "source": "when2call"})
        if len(out) >= n:
            break
    return out


def score(args):
    from metrics import canon
    from score import make_agent
    import cactus
    cactus.set_threads(args.threads)
    rows = [json.loads(l) for l in open(os.path.join(HERE, "data", "forget.jsonl"))]
    hits = {}
    with open(args.out, "w") as f:
        for r in rows:
            agent = make_agent(r["tools"], args.weights)
            try:
                resp = agent.complete(r["query"], max_new_tokens=200)
                calls = resp.get("function_calls") or []
            except Exception as e:  # a schema the engine refuses counts as a miss
                calls, resp = [], {"error": str(e)}
            agent.close()
            ok = canon(calls) == canon(r["answers"])
            hits.setdefault(r["source"], []).append(ok)
            f.write(json.dumps({**r, "pred": calls, "ok": ok}) + "\n")
    summary = {k: round(sum(v) / len(v), 3) for k, v in hits.items()}
    summary["all"] = round(sum(sum(v) for v in hits.values()) / sum(len(v) for v in hits.values()), 3)
    print(json.dumps({"weights": args.weights, **summary}))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=os.path.join(HERE, "..", "..", "public"))
    ap.add_argument("--out", default=os.path.join(HERE, "data", "forget.jsonl"))
    ap.add_argument("--n", type=int, default=100)
    ap.add_argument("--score", action="store_true")
    ap.add_argument("--weights", default="base")
    ap.add_argument("--threads", type=int, default=4)
    args = ap.parse_args()
    if args.score:
        return score(args)
    rng = random.Random(3)
    rows = mobile(args.root, rng, args.n) + hermes(args.root, rng, args.n) + when2call(args.root, rng, args.n)
    with open(args.out, "w") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    print(len(rows), "rows ->", args.out)


if __name__ == "__main__":
    main()
