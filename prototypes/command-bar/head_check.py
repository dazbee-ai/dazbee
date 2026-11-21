"""PROTOTYPE, never merged. Finds which token sequence the engine's confidence head reads, by
comparing the JAX head on candidate sequences with the confidence the engine reports for the
same archive (the base checkpoint at 4 bits, with its own head). The engine reports
min(head, decode probability), so the right sequence gives a JAX score equal to the engine's
whenever the head is the lower of the two, and never below it.

  JAX_PLATFORMS=cpu python head_check.py --weights ../models/base/L20.cact --n 40
"""
import argparse
import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from tools import ACTIONS  # noqa: E402


def engine_rows(weights, rows):
    from score import make_agent
    agents = {a: make_agent(t, weights) for a, t in ACTIONS.items()}
    out = []
    for r in rows:
        a = agents[r["area"]]
        resp = a.complete(r["query"], max_new_tokens=160)
        out.append({**r, "resp": resp})
    for a in agents.values():
        a.close()
    return out


def candidates(row):
    from cactus.model.tokenizer import (IM_END, IM_START, THINK_END, THINK_START, TOOL_CALL_END,
                                        TOOL_CALL_START, TOOLS_END, TOOLS_START)
    tools = ACTIONS[row["area"]]
    resp = row["resp"]
    calls = resp.get("function_calls") or resp.get("suppressed_calls") or []
    reasoning = (resp.get("reasoning") or "").strip()
    out = {}
    for tj_name, tj in [("compact", json.dumps(tools, separators=(",", ":"), ensure_ascii=False)),
                        ("spaced", json.dumps(tools))]:
        prompt = (IM_START + "user\n" + TOOLS_START + tj + TOOLS_END + "\n" + row["query"] + IM_END
                  + "\n" + IM_START + "assistant\n")
        cj = json.dumps(calls, separators=(",", ":"), ensure_ascii=False)
        think = THINK_START + "\n" + reasoning + "\n" + THINK_END + "\n" if reasoning else ""
        call = TOOL_CALL_START + cj + TOOL_CALL_END
        out[f"{tj_name}/prompt"] = prompt
        out[f"{tj_name}/think+call"] = prompt + think + call
        out[f"{tj_name}/think+call+end"] = prompt + think + call + IM_END
        out[f"{tj_name}/call"] = prompt + call
        out[f"{tj_name}/call+end"] = prompt + call + IM_END
    return out


_CACHE = {}


def head_scores(texts, checkpoint, eos=False):
    import jax
    import jax.numpy as jnp
    from cactus.model.architecture import SimpleAttentionNetwork
    from cactus.model.quantize import configure_deploy, cq_ste_params, WEIGHT_BITS
    from cactus.model.run import load_checkpoint
    from cactus.model.tokenizer import BOS_ID, EOS_ID, get_tokenizer

    if checkpoint not in _CACHE:
        params, config = load_checkpoint(checkpoint)
        config.dtype = "float32"
        params = jax.tree.map(lambda a: jnp.asarray(np.asarray(a), jnp.float32), params)
        configure_deploy(act_bits=8, kv_bits=8)
        qparams = cq_ste_params(params, WEIGHT_BITS)
        model = SimpleAttentionNetwork(config)
        tok = get_tokenizer(config.vocab_size)
        fn = jax.jit(lambda p, ids: model.apply({"params": p}, ids, quant=True,
                                                method=model.forward_confidence))
        _CACHE[checkpoint] = (qparams, tok, fn)
    qparams, tok, fn = _CACHE[checkpoint]
    out = []
    for t in texts:
        ids = [BOS_ID] + tok.encode(t) + ([EOS_ID] if eos else [])
        pad = -(-len(ids) // 64) * 64
        arr = np.zeros((1, pad), np.int32)
        arr[0, :len(ids)] = ids
        out.append(float(jax.nn.sigmoid(fn(qparams, jnp.asarray(arr))[0])))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--weights", required=True)
    ap.add_argument("--checkpoint", default=os.path.join(HERE, "..", "checkpoints", "needle3.safetensors"))
    ap.add_argument("--n", type=int, default=40)
    args = ap.parse_args()
    rows = [json.loads(l) for l in open(os.path.join(HERE, "data", "validation.queries.jsonl"))]
    rows = [r for r in rows if r["area"]][:args.n]
    rows = engine_rows(args.weights, rows)
    rows = [r for r in rows if r["resp"].get("confidence") is not None and
            (r["resp"].get("function_calls") or r["resp"].get("suppressed_calls"))]
    cands = [candidates(r) for r in rows]
    eng = np.array([r["resp"]["confidence"] for r in rows])
    for name in cands[0]:
        for eos in (False, True):
            s = np.array(head_scores([c[name] for c in cands], args.checkpoint, eos))
            close = np.abs(s - eng) < 0.01
            below = s < eng - 0.01
            print(f"{name:28s} eos={eos!s:5s} equal {close.mean():.2f}  head below engine {below.mean():.2f}"
                  f"  corr {np.corrcoef(s, eng)[0, 1]:.2f}", flush=True)
    print("engine", np.round(eng[:10], 3).tolist())


if __name__ == "__main__":
    main()
