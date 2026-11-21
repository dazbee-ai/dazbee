"""PROTOTYPE, never merged. Trains Needle's confidence head for our tuned weights; Cactus has no
open path for this, and `cactus build --lora` drops the base head.

The head reads every hidden-state row (the embedding and the 20 blocks) of the prompt plus the
call the model wrote, and gives one logit; the engine reports min(sigmoid(logit), decode
probability). The prompt is the training render with compact tools JSON, followed by what the
model generated: its reasoning line in a think block, then the call (head_check.py found this
is the sequence the engine scores). Here the backbone
is the LoRA-merged checkpoint under the export's numerics (CQ4 weights, A8), frozen; only the
head trains, from the base head's values, with binary cross-entropy:

  label 1: a call the tuned model made (through the engine) that is exactly right for that turn
  label 0: a call it made that is wrong, including calls made with another area's tools
  plus the gold call (1) and near misses of it (0: another option, a sibling tool, another number)

Its outputs: head.safetensors (confidence_head/* as the checkpoint names them) for
export_cact.py --head, and the validation scores per epoch.

  python train_head.py --lora runs/r16/best.safetensors \
      --engine results/r16-L20-calib-every.jsonl results/r16-L20-train-every.jsonl \
      --val results/r16-L20-validation-every.jsonl --out runs/head-r16
"""
import argparse
import json
import os
import random
import sys
import time

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from gen_data import reasoning  # noqa: E402
from metrics import auroc, canon, ece  # noqa: E402
from tools import ACTIONS, AREAS, TOOL  # noqa: E402


def render(query, tools, calls, reasoning_line):
    from cactus.model.tokenizer import (IM_END, IM_START, THINK_END, THINK_START, TOOL_CALL_END,
                                        TOOL_CALL_START, TOOLS_END, TOOLS_START)
    tj = json.dumps(tools, separators=(",", ":"), ensure_ascii=False)
    cj = json.dumps(calls, separators=(",", ":"), ensure_ascii=False)
    think = THINK_START + "\n" + (reasoning_line or "").strip() + "\n" + THINK_END + "\n"
    return (IM_START + "user\n" + TOOLS_START + tj + TOOLS_END + "\n" + query + IM_END + "\n"
            + IM_START + "assistant\n" + think + TOOL_CALL_START + cj + TOOL_CALL_END)


def engine_examples(rows, source):
    """Head examples from the engine's own calls, both turns, and other areas' turn two."""
    out = []
    for r in rows:
        gold_area, gold = r["area"], r["answers"]
        made = r["r1"]["calls"] or r["r1"]["held"]
        if made:
            ok = bool(gold_area) and made[0]["name"] == gold_area
            out.append((render(r["query"], AREAS, made[:1], r["r1"]["reasoning"]), int(ok), source + "/route"))
        turns = []
        if r.get("r2") and r["r1"]["calls"]:
            turns.append((r["r1"]["calls"][0]["name"], r["r2"]))
        for a, t in (r.get("others") or {}).items():
            turns.append((a, t))
        for area, t in turns:
            made = t["calls"] or t["held"]
            if not made:
                continue
            ok = area == gold_area and canon(made[:1]) == canon(gold)
            out.append((render(r["query"], ACTIONS[area], made[:1], t["reasoning"]), int(ok), source + "/act"))
    return out


def near_misses(call, rng, k=2):
    """Calls one step off the gold one: another option, a sibling tool, another number."""
    out = []
    tool = TOOL[call["name"]]
    props = tool["parameters"]["properties"]
    for _ in range(k * 3):
        if len(out) >= k:
            break
        kind = rng.random()
        args = dict(call["arguments"])
        if kind < 0.5 and props:
            name = rng.choice(list(props))
            spec = props[name]
            if "enum" in spec:
                choices = [v for v in spec["enum"] if v != args.get(name)]
                args[name] = rng.choice(choices)
            elif spec.get("type") == "integer":
                v = args.get(name, spec.get("default", 10))
                args[name] = int(v) + rng.choice([-20, -5, -1, 1, 5, 20, 45]) if v else 15
                lo, hi = spec.get("minimum", -10 ** 6), spec.get("maximum", 10 ** 6)
                args[name] = max(lo, min(hi, args[name]))
            elif spec.get("type") == "boolean":
                args[name] = not args.get(name, True)
            else:
                continue
            cand = {"name": call["name"], "arguments": args}
        else:
            area = next(a for a, ts in ACTIONS.items() if any(t["name"] == call["name"] for t in ts))
            sib = rng.choice([t for t in ACTIONS[area] if t["name"] != call["name"]])
            sargs = {}
            for n, spec in sib["parameters"]["properties"].items():
                if n not in sib["parameters"]["required"]:
                    continue
                if "enum" in spec:
                    sargs[n] = rng.choice(spec["enum"])
                elif spec.get("type") == "integer":
                    sargs[n] = spec.get("default", rng.choice([10, 20, 45, 50]))
                elif spec.get("type") == "boolean":
                    sargs[n] = True
                elif spec.get("pattern"):
                    sargs[n] = "#1A2B3C"
            cand = {"name": sib["name"], "arguments": sargs}
        if canon([cand]) != canon([call]):
            out.append(cand)
    return out


def gold_examples(rows, rng, source):
    out = []
    for r in rows:
        if not r["answers"]:
            continue
        call = r["answers"][0]
        tools = ACTIONS[r["area"]]
        out.append((render(r["query"], tools, [call], reasoning(call)), 1, source + "/gold"))
        for c in near_misses(call, rng):
            out.append((render(r["query"], tools, [c], reasoning(c)), 0, source + "/near"))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--checkpoint", default=os.path.join(HERE, "..", "checkpoints", "needle3.safetensors"))
    ap.add_argument("--lora", required=True)
    ap.add_argument("--engine", nargs="+", required=True, help="score.py outputs to learn from")
    ap.add_argument("--val", required=True, help="score.py output on validation, for early stopping")
    ap.add_argument("--gold-weight", type=float, default=0.5,
                    help="share of a gold or near-miss example in the loss, next to an engine one")
    ap.add_argument("--lr", type=float, default=3e-4)
    ap.add_argument("--batch", type=int, default=16)
    ap.add_argument("--epochs", type=int, default=8)
    ap.add_argument("--max-len", type=int, default=576)
    ap.add_argument("--limit", type=int, default=0, help="first rows of each file only, for a smoke test")
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    import jax
    import jax.numpy as jnp
    import optax
    from cactus.model.architecture import ConfidenceHead, SimpleAttentionNetwork
    from cactus.model.checkpoints import flatten
    from cactus.model.quantize import WEIGHT_BITS, configure_deploy, cq_ste_params
    from cactus.model.tokenizer import BOS_ID, get_tokenizer
    from safetensors.numpy import save_file
    from export_cact import load_params

    os.makedirs(args.out, exist_ok=True)
    logf = open(os.path.join(args.out, "log.jsonl"), "a")

    def emit(**kw):
        kw["time"] = time.strftime("%H:%M:%S")
        print(json.dumps(kw), flush=True)
        logf.write(json.dumps(kw) + "\n")
        logf.flush()

    rng = random.Random(0)
    def load(p):
        rows = [json.loads(l) for l in open(p, encoding="utf-8")]
        return rows[:args.limit] if args.limit else rows
    train = []
    for path in args.engine:
        rows = load(path)
        name = os.path.basename(path)
        train += engine_examples(rows, name)
        train += gold_examples(rows, rng, name)
    val_rows = load(args.val)
    val = engine_examples(val_rows, "val")
    emit(event="data", train=len(train), train_pos=sum(l for _, l, _ in train),
         val=len(val), val_pos=sum(l for _, l, _ in val))

    # The base checkpoint's head is where training starts.
    full, config = load_params(args.checkpoint, None if args.lora == "none" else args.lora,
                               keep_base_head=True)
    config.dtype = "float32"
    full = jax.tree.map(lambda a: jnp.asarray(np.asarray(a), jnp.float32), full)
    head = full[ConfidenceHead.key]
    backbone = {k: v for k, v in full.items() if k != ConfidenceHead.key}
    configure_deploy(act_bits=8, kv_bits=8)
    backbone = cq_ste_params(backbone, WEIGHT_BITS)
    model = SimpleAttentionNetwork(config)
    tok = get_tokenizer(config.vocab_size)

    def encode(examples):
        ids = np.zeros((len(examples), args.max_len), np.int32)
        for i, (text, _, _) in enumerate(examples):
            t = [BOS_ID] + tok.encode(text)
            t = t[:args.max_len]
            ids[i, :len(t)] = t
        return ids

    tr_ids, va_ids = encode(train), encode(val)
    tr_y = np.array([l for _, l, _ in train], np.float32)
    tr_w = np.array([args.gold_weight if s.endswith(("/gold", "/near")) else 1.0 for _, _, s in train],
                    np.float32)
    va_y = np.array([l for _, l, _ in val], np.float32)

    def logits(head, ids):
        return model.apply({"params": {**backbone, ConfidenceHead.key: head}}, ids, quant=True,
                           method=model.forward_confidence)

    def loss_fn(head, ids, y, w):
        z = logits(head, ids)
        return (optax.sigmoid_binary_cross_entropy(z, y) * w).sum() / w.sum()

    steps = args.epochs * (len(train) // args.batch)
    opt = optax.chain(optax.clip_by_global_norm(1.0),
                      optax.adamw(optax.warmup_cosine_decay_schedule(0, args.lr, max(1, steps // 20), steps),
                                  weight_decay=0.01))
    state = opt.init(head)

    @jax.jit
    def step(head, state, ids, y, w):
        loss, g = jax.value_and_grad(loss_fn)(head, ids, y, w)
        upd, state = opt.update(g, state, head)
        return optax.apply_updates(head, upd), state, loss

    score = jax.jit(logits)

    def val_scores(head):
        z = []
        for i in range(0, len(va_ids), args.batch):
            b = va_ids[i:i + args.batch]
            pad = args.batch - len(b)
            if pad:
                b = np.concatenate([b, np.repeat(b[-1:], pad, 0)])
            z += list(np.asarray(score(head, jnp.asarray(b)))[:args.batch - pad])
        return np.array(z)

    def report(epoch, head, extra):
        z = val_scores(head)
        p = 1 / (1 + np.exp(-z))
        bce = float(np.mean(np.logaddexp(0, z) - va_y * z))
        a = auroc(list(p[va_y == 1]), list(p[va_y == 0]))
        emit(event="epoch", epoch=epoch, val_bce=bce, val_auroc=a,
             val_ece=ece(list(p), list(va_y.astype(int))), **extra)
        return bce, a, z

    best = None
    bce, a, z = report(0, head, {})
    best = (bce, 0)
    np_head = jax.tree.map(np.asarray, head)
    save_file(flatten(np_head), os.path.join(args.out, "head.safetensors"))
    t0 = time.time()
    order = np.arange(len(train))
    for epoch in range(1, args.epochs + 1):
        np.random.default_rng(epoch).shuffle(order)
        losses = []
        for s in range(0, len(order) - args.batch + 1, args.batch):
            idx = order[s:s + args.batch]
            head, state, loss = step(head, state, jnp.asarray(tr_ids[idx]), jnp.asarray(tr_y[idx]),
                                     jnp.asarray(tr_w[idx]))
            losses.append(float(loss))
        bce, a, z = report(epoch, head, {"train_loss": float(np.mean(losses)),
                                         "minutes": round((time.time() - t0) / 60, 1)})
        if bce < best[0]:
            best = (bce, epoch)
            save_file(flatten(jax.tree.map(np.asarray, head)), os.path.join(args.out, "head.safetensors"))
            np.save(os.path.join(args.out, "val_logits.npy"), z)
            emit(event="best", epoch=epoch, val_bce=bce, val_auroc=a)
    emit(event="done", best_epoch=best[1], best_val_bce=best[0], minutes=round((time.time() - t0) / 60, 1))

    # Platt scaling on validation, folded into the head's last projection: logit' = a * logit + c.
    from safetensors.numpy import load_file
    from cactus.model.checkpoints import unflatten
    z = np.load(os.path.join(args.out, "val_logits.npy")) if best[1] else val_scores(head)
    a_, c_ = 1.0, 0.0
    for _ in range(500):
        p = 1 / (1 + np.exp(-(a_ * z + c_)))
        g = p - va_y
        ga, gc = float(np.mean(g * z)), float(np.mean(g))
        h = p * (1 - p)
        haa, hac, hcc = float(np.mean(h * z * z)) + 1e-6, float(np.mean(h * z)), float(np.mean(h)) + 1e-6
        det = haa * hcc - hac * hac
        a_ -= (hcc * ga - hac * gc) / det
        c_ -= (haa * gc - hac * ga) / det
    best_head = unflatten(load_file(os.path.join(args.out, "head.safetensors")))
    best_head["proj"]["kernel"] = best_head["proj"]["kernel"] * a_
    best_head["proj"]["bias"] = best_head["proj"]["bias"] * a_ + c_
    save_file(flatten(best_head), os.path.join(args.out, "head_platt.safetensors"))
    p = 1 / (1 + np.exp(-(a_ * z + c_)))
    emit(event="platt", a=a_, c=c_, val_ece_after=ece(list(p), list(va_y.astype(int))))


if __name__ == "__main__":
    main()
