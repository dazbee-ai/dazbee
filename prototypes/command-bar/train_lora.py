"""PROTOTYPE, never merged. LoRA on Needle 3, as `cactus finetune` does it (q/k/v/gate/out of all
20 layers, float32, the 4-bit CQ weights simulated in the loss), with our own validation file and
early stopping on it.

  python train_lora.py --rank 16 --alpha 32 --epochs 30 --out runs/r16

Every epoch scores the validation rows by teacher forcing: a row counts as exact when every
target token is the model's top token, which is exactly when greedy decoding would write the
whole target. The adapter with the best exact share (then the lowest loss) is kept as best.safetensors.
"""
import argparse
import json
import os
import time

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--checkpoint", default=os.path.join(HERE, "..", "checkpoints", "needle3.safetensors"))
    ap.add_argument("--train", default=os.path.join(HERE, "data", "train.needle.jsonl"))
    ap.add_argument("--val", default=os.path.join(HERE, "data", "validation.needle.jsonl"))
    ap.add_argument("--rank", type=int, default=16)
    ap.add_argument("--alpha", type=float, default=32)
    ap.add_argument("--lr", type=float, default=1e-4)
    ap.add_argument("--batch", type=int, default=16)
    ap.add_argument("--epochs", type=int, default=30)
    ap.add_argument("--patience", type=int, default=5)
    ap.add_argument("--max-len", type=int, default=1024)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--init-from", help="an adapter to start from instead of a fresh one")
    ap.add_argument("--no-qat", action="store_true",
                    help="train on float weights (activations still A8); the export quantizes them")
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    import jax
    import jax.numpy as jnp
    import optax
    from cactus.model.architecture import SimpleAttentionNetwork
    from cactus.model.checkpoints import write_adapter
    from cactus.model.finetune import (fit_max_len, init_lora, load_jsonl, lora_target_paths,
                                       merge_lora)
    from cactus.model.quantize import WEIGHT_BITS, configure_deploy, cq_ste_params
    from cactus.model.run import load_checkpoint
    from cactus.model.tokenizer import get_tokenizer

    os.makedirs(args.out, exist_ok=True)
    log = open(os.path.join(args.out, "log.jsonl"), "a")

    def emit(**kw):
        kw["time"] = time.strftime("%H:%M:%S")
        print(json.dumps(kw), flush=True)
        log.write(json.dumps(kw) + "\n")
        log.flush()

    params, config = load_checkpoint(args.checkpoint)
    config.dtype = "float32"
    params = jax.tree.map(lambda a: np.asarray(a).astype(np.float32), params)
    params = jax.device_put(params)
    tok = get_tokenizer(config.vocab_size)
    max_len = max(fit_max_len(args.train, tok, args.max_len), fit_max_len(args.val, tok, args.max_len))
    seqs, masks = load_jsonl(args.train, tok, max_len)
    vseqs, vmasks = load_jsonl(args.val, tok, max_len)
    model = SimpleAttentionNetwork(config)
    configure_deploy(act_bits=getattr(config, "act_bits", 8), kv_bits=getattr(config, "kv_bits", 8))
    paths = lora_target_paths(params)
    scale = args.alpha / args.rank
    rng = np.random.default_rng(args.seed)
    lora = init_lora(params, paths, args.rank, jax.random.PRNGKey(args.seed))
    if args.init_from:
        from cactus.model.checkpoints import read_adapter
        saved = read_adapter(args.init_from)["lora"]
        lora = {p: {"A": jnp.asarray(saved["/".join(p)]["A"]), "B": jnp.asarray(saved["/".join(p)]["B"])}
                for p in lora}
    emit(event="start", train=len(seqs), val=len(vseqs), seq_len=max_len, rank=args.rank,
         alpha=args.alpha, lr=args.lr, groups=len(paths), backend=jax.default_backend())

    steps_per_epoch = -(-len(seqs) // args.batch)
    total = args.epochs * steps_per_epoch
    warmup = max(1, total // 20)
    schedule = optax.warmup_cosine_decay_schedule(0.0, args.lr, warmup, total)
    opt = optax.chain(optax.clip_by_global_norm(1.0), optax.adamw(schedule))
    state = opt.init(lora)

    def logits_of(lora, ids):
        merged = merge_lora(params, lora, scale)
        if not args.no_qat:
            merged = cq_ste_params(merged, WEIGHT_BITS)
        return model.apply({"params": merged}, ids, quant=True)

    def loss_fn(lora, ids, mask):
        logits = logits_of(lora, ids)
        logits, targets, mask = logits[:, :-1], ids[:, 1:], mask[:, 1:]
        ce = optax.softmax_cross_entropy_with_integer_labels(logits, targets)
        return (ce * mask).sum() / jnp.maximum(mask.sum(), 1.0)

    @jax.jit
    def step(lora, state, ids, mask):
        loss, grads = jax.value_and_grad(loss_fn)(lora, ids, mask)
        updates, state = opt.update(grads, state, lora)
        return optax.apply_updates(lora, updates), state, loss

    @jax.jit
    def evaluate(lora, ids, mask):
        logits = logits_of(lora, ids)
        logits, targets, mask = logits[:, :-1], ids[:, 1:], mask[:, 1:]
        ce = optax.softmax_cross_entropy_with_integer_labels(logits, targets)
        hit = (jnp.argmax(logits, -1) == targets) | (mask == 0)
        return (ce * mask).sum(), mask.sum(), jnp.all(hit, axis=-1)

    def validate(lora):
        ce, count, exact = 0.0, 0.0, []
        for i in range(0, len(vseqs), args.batch):
            ids, m = vseqs[i:i + args.batch], vmasks[i:i + args.batch]
            pad = args.batch - len(ids)
            if pad:
                ids = np.concatenate([ids, np.repeat(ids[-1:], pad, 0)])
                m = np.concatenate([m, np.zeros((pad, m.shape[1]), m.dtype)])
            c, n, e = evaluate(lora, jnp.asarray(ids), jnp.asarray(m))
            ce += float(c)
            count += float(n)
            exact += list(np.asarray(e)[:args.batch - pad])
        return ce / count, float(np.mean(exact))

    # Resumable: every epoch saves the adapter, the optimizer and where it stands, so a restart
    # of the machine costs at most the epoch in progress.
    state_path = os.path.join(args.out, "state.npz")
    first = 1
    if os.path.exists(state_path):
        saved = np.load(state_path, allow_pickle=False)
        leaves, treedef = jax.tree_util.tree_flatten((lora, state))
        lora, state = jax.tree_util.tree_unflatten(
            treedef, [jnp.asarray(saved[f"l{i}"]) for i in range(len(leaves))])
        first = int(saved["epoch"]) + 1
        best, stale = (float(saved["best_exact"]), float(saved["best_neg_loss"])), int(saved["stale"])
        emit(event="resume", epoch=first - 1)
    else:
        vloss, vexact = validate(lora)
        emit(event="epoch", epoch=0, val_loss=vloss, val_exact=vexact)
        best, stale = (vexact, -vloss), 0
    t0 = time.time()
    for epoch in range(first, args.epochs + 1):
        if stale >= args.patience:
            break
        order = np.random.default_rng(args.seed * 1000 + epoch).permutation(len(seqs))
        losses = []
        for s in range(0, len(seqs), args.batch):
            idx = order[s:s + args.batch]
            if len(idx) < args.batch:
                idx = np.concatenate([idx, order[:args.batch - len(idx)]])
            lora, state, loss = step(lora, state, jnp.asarray(seqs[idx]), jnp.asarray(masks[idx]))
            losses.append(float(loss))
            if len(losses) % 100 == 0:
                emit(event="steps", epoch=epoch, done=len(losses), loss=float(np.mean(losses[-100:])),
                     minutes=round((time.time() - t0) / 60, 2))
        vloss, vexact = validate(lora)
        emit(event="epoch", epoch=epoch, train_loss=float(np.mean(losses)), val_loss=vloss,
             val_exact=vexact, minutes=round((time.time() - t0) / 60, 1))
        adapter = {"lora": {"/".join(p): {"A": np.asarray(v["A"]), "B": np.asarray(v["B"])}
                            for p, v in lora.items()},
                   "scale": float(scale), "base": args.checkpoint, "rank": args.rank, "seed": args.seed}
        write_adapter(os.path.join(args.out, "last.safetensors"), adapter)
        if (vexact, -vloss) > best:
            best, stale = (vexact, -vloss), 0
            write_adapter(os.path.join(args.out, "best.safetensors"), adapter)
            emit(event="best", epoch=epoch, val_exact=vexact, val_loss=vloss)
        else:
            stale += 1
        leaves = jax.tree_util.tree_leaves((lora, state))
        np.savez(state_path + ".tmp.npz", epoch=epoch, best_exact=best[0], best_neg_loss=best[1],
                 stale=stale, **{f"l{i}": np.asarray(x) for i, x in enumerate(leaves)})
        os.replace(state_path + ".tmp.npz", state_path)
        if stale >= args.patience:
            emit(event="early_stop", epoch=epoch)
            break
    emit(event="done", best_val_exact=best[0], best_val_loss=-best[1],
         minutes=round((time.time() - t0) / 60, 1))


if __name__ == "__main__":
    main()
