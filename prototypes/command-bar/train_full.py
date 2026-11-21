"""PROTOTYPE, never merged. Full fine-tuning of Needle 3 on the command bar, with replay: every
fourth step is a batch of public tool-calling requests on which the model is held to the base
model's own next-token distribution (a KL term), so it keeps what it knew. All weights train
except the probe heads; the 4-bit CQ weights are simulated in the loss, as for LoRA.

  python train_full.py --epochs 6 --out runs/full

Replay rows come from the forgetting sources (forget_set.py) but never the rows the forgetting
check scores. The best epoch by validation exact share (teacher forcing) is written as a
checkpoint export_cact.py reads (--checkpoint runs/full/best.safetensors).
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


def replay_rows(root, n_each, seed=11):
    """Public rows the forgetting check does not use, rendered with no reasoning line."""
    import forget_set
    held = {json.dumps([r["query"], r["answers"]], sort_keys=True)
            for r in map(json.loads, open(os.path.join(HERE, "data", "forget.jsonl")))}
    rng = random.Random(seed)
    rows = []
    for fn in (forget_set.mobile, forget_set.hermes):
        for r in fn(root, rng, n_each * 3):
            if json.dumps([r["query"], r["answers"]], sort_keys=True) not in held:
                rows.append(r)
            if sum(1 for x in rows if x["source"] == r["source"]) >= n_each:
                break
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--checkpoint", default=os.path.join(HERE, "..", "checkpoints", "needle3.safetensors"))
    ap.add_argument("--train", default=os.path.join(HERE, "data", "train.needle.jsonl"))
    ap.add_argument("--val", default=os.path.join(HERE, "data", "validation.needle.jsonl"))
    ap.add_argument("--public", default=os.path.join(HERE, "..", "..", "public"))
    ap.add_argument("--replay-each", type=int, default=400)
    ap.add_argument("--kl-weight", type=float, default=1.0)
    ap.add_argument("--lr", type=float, default=2e-5)
    ap.add_argument("--batch", type=int, default=16)
    ap.add_argument("--epochs", type=int, default=6)
    ap.add_argument("--max-len", type=int, default=544)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    import jax
    import jax.numpy as jnp
    import optax
    from cactus.model.architecture import HEADS, SimpleAttentionNetwork
    from cactus.model.checkpoints import read_checkpoint, write_checkpoint
    from cactus.model.finetune import _encode, load_jsonl
    from cactus.model.quantize import WEIGHT_BITS, configure_deploy, cq_ste_params
    from cactus.model.run import load_checkpoint
    from cactus.model.tokenizer import get_tokenizer

    os.makedirs(args.out, exist_ok=True)
    logf = open(os.path.join(args.out, "log.jsonl"), "a")

    def emit(**kw):
        kw["time"] = time.strftime("%H:%M:%S")
        print(json.dumps(kw), flush=True)
        logf.write(json.dumps(kw) + "\n")
        logf.flush()

    params, config = load_checkpoint(args.checkpoint)
    config.dtype = "float32"
    params = jax.tree.map(lambda a: jnp.asarray(np.asarray(a), jnp.float32), params)
    head_keys = {h.key for h in HEADS}
    frozen = {k: v for k, v in params.items() if k in head_keys}
    train_p = {k: v for k, v in params.items() if k not in head_keys}
    base_q = cq_ste_params(train_p, WEIGHT_BITS)
    configure_deploy(act_bits=8, kv_bits=8)
    model = SimpleAttentionNetwork(config)
    tok = get_tokenizer(config.vocab_size)
    seqs, masks = load_jsonl(args.train, tok, args.max_len)
    vseqs, vmasks = load_jsonl(args.val, tok, args.max_len)
    rep = replay_rows(args.public, args.replay_each)
    enc = [_encode(tok, {**r, "reasoning": ""}, args.max_len) for r in rep]
    rseqs = np.array([e[0] for e in enc], np.int32)
    rmasks = np.array([e[1] for e in enc], np.float32)
    emit(event="start", train=len(seqs), val=len(vseqs), replay=len(rseqs), lr=args.lr,
         kl_weight=args.kl_weight, backend=jax.default_backend())

    steps_per_epoch = len(seqs) // args.batch
    total = args.epochs * steps_per_epoch
    sched = optax.warmup_cosine_decay_schedule(0.0, args.lr, max(1, total // 20), total)
    opt = optax.chain(optax.clip_by_global_norm(1.0), optax.adamw(sched, weight_decay=0.0))
    state = opt.init(train_p)

    def logits_of(p, ids):
        return model.apply({"params": {**cq_ste_params(p, WEIGHT_BITS), **frozen}}, ids, quant=True)

    def ce_loss(p, ids, mask):
        lg = logits_of(p, ids)[:, :-1]
        ce = optax.softmax_cross_entropy_with_integer_labels(lg, ids[:, 1:])
        m = mask[:, 1:]
        return (ce * m).sum() / jnp.maximum(m.sum(), 1.0)

    def kl_loss(p, ids, mask):
        lg = jax.nn.log_softmax(logits_of(p, ids)[:, :-1], -1)
        base = jax.lax.stop_gradient(jax.nn.log_softmax(
            model.apply({"params": {**base_q, **frozen}}, ids, quant=True)[:, :-1], -1))
        kl = (jnp.exp(base) * (base - lg)).sum(-1)
        m = mask[:, 1:]
        return (kl * m).sum() / jnp.maximum(m.sum(), 1.0)

    @jax.jit
    def step(p, state, ids, mask):
        loss, g = jax.value_and_grad(ce_loss)(p, ids, mask)
        upd, state = opt.update(g, state, p)
        return optax.apply_updates(p, upd), state, loss

    @jax.jit
    def replay_step(p, state, ids, mask):
        loss, g = jax.value_and_grad(lambda q: args.kl_weight * kl_loss(q, ids, mask))(p)
        upd, state = opt.update(g, state, p)
        return optax.apply_updates(p, upd), state, loss

    @jax.jit
    def evaluate(p, ids, mask):
        lg = logits_of(p, ids)[:, :-1]
        t, m = ids[:, 1:], mask[:, 1:]
        ce = optax.softmax_cross_entropy_with_integer_labels(lg, t)
        return (ce * m).sum(), m.sum(), jnp.all((jnp.argmax(lg, -1) == t) | (m == 0), -1)

    def validate(p):
        ce, cnt, ex = 0.0, 0.0, []
        for i in range(0, len(vseqs), args.batch):
            ids, m = vseqs[i:i + args.batch], vmasks[i:i + args.batch]
            pad = args.batch - len(ids)
            if pad:
                ids = np.concatenate([ids, np.repeat(ids[-1:], pad, 0)])
                m = np.concatenate([m, np.zeros((pad, m.shape[1]), m.dtype)])
            c, n, e = evaluate(p, jnp.asarray(ids), jnp.asarray(m))
            ce += float(c)
            cnt += float(n)
            ex += list(np.asarray(e)[:args.batch - pad])
        return ce / cnt, float(np.mean(ex))

    best, t0 = (-1.0, 0.0), time.time()
    rng = np.random.default_rng(0)
    for epoch in range(1, args.epochs + 1):
        order = rng.permutation(len(seqs))
        losses, kls = [], []
        for s in range(steps_per_epoch):
            idx = order[s * args.batch:(s + 1) * args.batch]
            train_p, state, loss = step(train_p, state, jnp.asarray(seqs[idx]), jnp.asarray(masks[idx]))
            losses.append(float(loss))
            if s % 4 == 3:
                ridx = rng.integers(0, len(rseqs), args.batch)
                train_p, state, kl = replay_step(train_p, state, jnp.asarray(rseqs[ridx]),
                                                 jnp.asarray(rmasks[ridx]))
                kls.append(float(kl))
        vloss, vexact = validate(train_p)
        emit(event="epoch", epoch=epoch, train_loss=float(np.mean(losses)), replay_kl=float(np.mean(kls)),
             val_loss=vloss, val_exact=vexact, minutes=round((time.time() - t0) / 60, 1))
        if (vexact, -vloss) > best:
            best = (vexact, -vloss)
            saved = read_checkpoint(args.checkpoint)
            write_checkpoint(os.path.join(args.out, "best.safetensors"), {
                "format_version": saved["format_version"], "config": saved["config"],
                "params": jax.tree.map(np.asarray, {**train_p, **frozen}), "step": epoch,
                "run": {"note": "command bar full fine-tune"}})
            emit(event="best", epoch=epoch, val_exact=vexact)
    emit(event="done", best_val_exact=best[0], minutes=round((time.time() - t0) / 60, 1))


if __name__ == "__main__":
    main()
