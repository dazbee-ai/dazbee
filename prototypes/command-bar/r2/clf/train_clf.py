"""PROTOTYPE, never merged. Fine-tunes a small encoder to pick a request's outcome class (82
edits or no call); slots.py reads the number or hex code. Resumable per epoch (model, optimiser,
schedule and the best score so far are saved after every epoch).

  python train_clf.py --base sentence-transformers/all-MiniLM-L12-v2 --out runs/minilm12 --epochs 12

The kept checkpoint is the epoch with the best validation exact share (class right and, for
classes with a value, the value slots.py reads equal to the gold one).
"""
import argparse
import json
import os
import random
import re
import sys
import time

import numpy as np
import torch

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))

from data import load  # noqa: E402
from outcomes import DEFAULTS, LABELS, NONE  # noqa: E402
from slots import value_for  # noqa: E402

KEYS = "qwertyuiopasdfghjklzxcvbnm"


def noisy(text, rng):
    """Generic typing noise: a swapped, dropped, doubled or wrong letter, case changes."""
    if rng.random() < 0.25:
        words = text.split(" ")
        idx = [i for i, w in enumerate(words) if len(w) > 3 and w.isalpha()]
        if idx:
            i = rng.choice(idx)
            w = words[i]
            j = rng.randrange(1, len(w) - 1)
            op = rng.randrange(4)
            if op == 0:
                w = w[:j] + w[j + 1] + w[j] + w[j + 2:]
            elif op == 1:
                w = w[:j] + w[j + 1:]
            elif op == 2:
                w = w[:j] + w[j] + w[j:]
            else:
                w = w[:j] + rng.choice(KEYS) + w[j + 1:]
            words[i] = w
            text = " ".join(words)
    r = rng.random()
    if r < 0.3:
        text = text.lower()
    elif r < 0.35:
        text = text.upper() if "#" not in text else text
    if rng.random() < 0.2:
        text = text.rstrip(".!?")
    return text


def outcome_ok(cls, value, pred, text):
    if pred != cls:
        return False
    if cls == NONE:
        return True
    v = value_for(text, pred)
    v = v if v is not None else DEFAULTS.get(pred)
    g = value if value is not None else DEFAULTS.get(cls)
    return v == g


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--epochs", type=int, default=12)
    ap.add_argument("--batch", type=int, default=32)
    ap.add_argument("--lr", type=float, default=8e-5)
    ap.add_argument("--max-len", type=int, default=64)
    ap.add_argument("--smoothing", type=float, default=0.1)
    ap.add_argument("--no-r1", action="store_true", help="leave round 1's templated requests out")
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--lora", type=int, default=0, help="LoRA rank instead of full fine-tuning (big decoders)")
    args = ap.parse_args()

    from transformers import AutoModelForSequenceClassification, AutoTokenizer, get_cosine_schedule_with_warmup

    os.makedirs(args.out, exist_ok=True)
    log = open(os.path.join(args.out, "log.jsonl"), "a")

    def emit(**kw):
        kw["time"] = time.strftime("%H:%M:%S")
        print(json.dumps(kw), flush=True)
        log.write(json.dumps(kw) + "\n")
        log.flush()

    torch.manual_seed(args.seed)
    rng = random.Random(args.seed)
    train, val = load(with_r1=not args.no_r1)
    lab = {c: i for i, c in enumerate(LABELS)}
    dev = "cuda" if torch.cuda.is_available() else "cpu"
    tok = AutoTokenizer.from_pretrained(args.base)
    model = AutoModelForSequenceClassification.from_pretrained(
        args.base, num_labels=len(LABELS), id2label=dict(enumerate(LABELS)), label2id=lab,
        ignore_mismatched_sizes=True, dtype=torch.float32).to(dev)
    if tok.pad_token is None:  # decoder models: pad with the end token, classify at the last real one
        tok.pad_token = tok.eos_token
    model.config.pad_token_id = tok.pad_token_id
    if args.lora:
        from peft import LoraConfig, get_peft_model
        model = get_peft_model(model, LoraConfig(r=args.lora, lora_alpha=2 * args.lora, lora_dropout=0.05,
                                                 target_modules="all-linear", modules_to_save=["score"],
                                                 task_type="SEQ_CLS"))
    steps = args.epochs * -(-len(train) // args.batch)
    opt = torch.optim.AdamW([p for p in model.parameters() if p.requires_grad], lr=args.lr, weight_decay=0.01)
    sched = get_cosine_schedule_with_warmup(opt, int(0.06 * steps), steps)
    lossf = torch.nn.CrossEntropyLoss(label_smoothing=args.smoothing)
    emit(event="start", base=args.base, train=len(train), val=len(val), labels=len(LABELS),
         params=sum(p.numel() for p in model.parameters()), device=dev)

    state_path = os.path.join(args.out, "state.pt")
    first, best = 1, -1.0
    if os.path.exists(state_path):
        st = torch.load(state_path, map_location=dev, weights_only=False)
        model.load_state_dict(st["model"])
        opt.load_state_dict(st["opt"])
        sched.load_state_dict(st["sched"])
        first, best = st["epoch"] + 1, st["best"]
        rng.setstate(st["rng"])
        emit(event="resume", epoch=st["epoch"])

    @torch.no_grad()
    def validate():
        model.eval()
        hits, n = 0, 0
        for i in range(0, len(val), 256):
            chunk = val[i:i + 256]
            enc = tok([r["query"] for r in chunk], padding=True, truncation=True,
                      max_length=args.max_len, return_tensors="pt").to(dev)
            pred = model(**enc).logits.argmax(-1).tolist()
            for r, p in zip(chunk, pred):
                hits += outcome_ok(r["cls"], r["value"], LABELS[p], r["query"])
                n += 1
        model.train()
        return hits / max(n, 1)

    model.train()
    for epoch in range(first, args.epochs + 1):
        order = list(range(len(train)))
        rng.shuffle(order)
        t0, losses = time.time(), []
        for s in range(0, len(order), args.batch):
            chunk = [train[k] for k in order[s:s + args.batch]]
            enc = tok([noisy(r["query"], rng) for r in chunk], padding=True, truncation=True,
                      max_length=args.max_len, return_tensors="pt").to(dev)
            y = torch.tensor([lab[r["cls"]] for r in chunk], device=dev)
            loss = lossf(model(**enc).logits, y)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            opt.step()
            sched.step()
            opt.zero_grad()
            losses.append(loss.item())
        acc = validate()
        emit(event="epoch", epoch=epoch, loss=float(np.mean(losses)), val_exact=acc,
             minutes=round((time.time() - t0) / 60, 2))
        if acc > best:
            best = acc
            if args.lora:
                import copy
                copy.deepcopy(model).merge_and_unload().save_pretrained(os.path.join(args.out, "best"))
            else:
                model.save_pretrained(os.path.join(args.out, "best"))
            tok.save_pretrained(os.path.join(args.out, "best"))
            emit(event="best", epoch=epoch, val_exact=acc)
        torch.save({"model": model.state_dict(), "opt": opt.state_dict(), "sched": sched.state_dict(),
                    "epoch": epoch, "best": best, "rng": rng.getstate()}, state_path + ".tmp")
        os.replace(state_path + ".tmp", state_path)
    emit(event="done", best_val_exact=best)


if __name__ == "__main__":
    main()
