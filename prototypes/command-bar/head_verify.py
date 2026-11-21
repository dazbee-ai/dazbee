"""PROTOTYPE, never merged. Checks our trained head inside the engine: the JAX head on the
sequence train_head.py renders (prompt, the engine's reasoning line, its call) against the
confidence the engine reports for the exported archive, which is min(head, decode probability).
Matching means the JAX score is never clearly below the engine's, and equal to it whenever the
head is the lower of the two.

  JAX_PLATFORMS=cpu python head_verify.py --lora runs/r16/best.safetensors \
      --head runs/head-r16/head_platt.safetensors --results results/r16-head-L20-validation-every.jsonl
"""
import argparse
import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from tools import ACTIONS, AREAS  # noqa: E402
from train_head import render  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--checkpoint", default=os.path.join(HERE, "..", "checkpoints", "needle3.safetensors"))
    ap.add_argument("--lora", required=True)
    ap.add_argument("--head", required=True)
    ap.add_argument("--results", required=True)
    ap.add_argument("--n", type=int, default=80)
    args = ap.parse_args()
    import jax
    import jax.numpy as jnp
    from cactus.model.architecture import SimpleAttentionNetwork
    from cactus.model.quantize import WEIGHT_BITS, configure_deploy, cq_ste_params
    from cactus.model.tokenizer import BOS_ID, get_tokenizer
    from export_cact import load_params

    params, config = load_params(args.checkpoint, args.lora, args.head)
    config.dtype = "float32"
    params = jax.tree.map(lambda a: jnp.asarray(np.asarray(a), jnp.float32), params)
    configure_deploy(act_bits=8, kv_bits=8)
    head = params["confidence_head"]
    q = cq_ste_params({k: v for k, v in params.items() if k != "confidence_head"}, WEIGHT_BITS)
    q["confidence_head"] = head
    model = SimpleAttentionNetwork(config)
    tok = get_tokenizer(config.vocab_size)
    fn = jax.jit(lambda p, ids: model.apply({"params": p}, ids, quant=True, method=model.forward_confidence))

    pairs = []
    for line in open(args.results):
        r = json.loads(line)
        for tools, t in [(AREAS, r["r1"]), (ACTIONS.get(r["r1"]["calls"][0]["name"]) if r["r1"]["calls"] else None, r.get("r2"))]:
            if not tools or not t or t.get("conf") is None:
                continue
            made = t["calls"] or t["held"]
            if not made:
                continue
            ids = [BOS_ID] + tok.encode(render(r["query"], tools, made[:1], t["reasoning"]))
            arr = np.zeros((1, -(-len(ids) // 64) * 64), np.int32)
            arr[0, :len(ids)] = ids
            pairs.append((float(jax.nn.sigmoid(fn(q, jnp.asarray(arr))[0])), t["conf"]))
        if len(pairs) >= args.n:
            break
    j = np.array([p[0] for p in pairs])
    e = np.array([p[1] for p in pairs])
    print(json.dumps({"pairs": len(pairs), "equal_within_0.01": float(np.mean(np.abs(j - e) < 0.01)),
                      "jax_below_engine_by_0.01": float(np.mean(j < e - 0.01)),
                      "corr": float(np.corrcoef(j, e)[0, 1]) if np.std(e) > 0 else None,
                      "first": [[round(a, 3), round(b, 3)] for a, b in pairs[:8]]}))


if __name__ == "__main__":
    main()
