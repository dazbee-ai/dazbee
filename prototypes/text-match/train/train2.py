"""PROTOTYPE. Round 3 trainer for the font fingerprint: 64-px-tall strips read in 64x256 windows, one ink
channel in, a unit fingerprint out; several backbones to compare, chosen on realistic development sets.

    python train/train2.py --arch resnet18 --data samples/lib64-r1,samples/lib64-r2 --out models/r3-resnet18

Backbones (--arch): ours (a residual CNN from scratch, the control), resnet18, convnext_atto and
mobilenetv4_conv_small (timm, ImageNet weights unless --scratch). Every backbone is read at its own
output (2 rows x 8 columns for a 64x256 window), averaged over the width only, so where strokes sit up
and down is kept; then LayerNorm and a linear layer to --dim numbers, unit length.

Training: CosFace (normalised softmax with a margin) over faces, with faces that draw near-identical
pixels merged into one class (--merge, from src/face-probes.ts), and a second CosFace head over
families (--family-weight). From --mine-from on, half of every batch is confusable faces: classes drawn
with their nearest classes by the head's weights, refreshed each epoch. AdamW with warm-up and cosine
decay; the first epoch trains only the heads when the backbone starts from ImageNet weights; bf16 with
the margin logits in fp32; channels_last; an EMA of the weights; windows 48 px tall for the first
--small-frac of the epochs, then 64. Augmentation on the GPU (augment.py): horizontal squeeze 5/6-7/6,
affine and perspective, per-glyph jitter, wobble, lost resolution, blur, JPEG blocks, noise, faded ink,
thicker or thinner strokes.

With --teacher, the run distils a trained model into this one ("patient and consistent": the teacher
and the student see the same augmented views; KL divergence between their softened class logits).

Every epoch saves the whole state (model, EMA, heads, optimiser, schedule, scaler, random state) to
<out>/last.pt, so a run cut off by a power cut resumes where it stopped, plus the EMA weights to
<out>/epoch-NN.pt; and measures the EMA weights on the development sets (evaluate2.py): face and family
top-1 and top-25 by nearest class mean. Checkpoints are chosen by those numbers, never by the loss.
"""

import argparse
import json
import math
import os
import queue
import threading
import time

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

from augment import augment_batch, crop_windows
from evaluate2 import Evaluator

H, WIN = 64, 256


# ---------------------------------------------------------------- models


class Block(nn.Module):
    def __init__(self, cin, cout, stride):
        super().__init__()
        self.c1 = nn.Conv2d(cin, cout, 3, stride, 1, bias=False)
        self.b1 = nn.BatchNorm2d(cout)
        self.c2 = nn.Conv2d(cout, cout, 3, 1, 1, bias=False)
        self.b2 = nn.BatchNorm2d(cout)
        self.skip = None
        if stride != 1 or cin != cout:
            self.skip = nn.Sequential(nn.Conv2d(cin, cout, 1, stride, bias=False), nn.BatchNorm2d(cout))

    def forward(self, x):
        y = F.relu(self.b1(self.c1(x)))
        y = self.b2(self.c2(y))
        return F.relu(y + (x if self.skip is None else self.skip(x)))


class Ours(nn.Module):
    """The first models' residual CNN (widths c, 2c, 4c, 4c, 6c, 6c), with a stride-2 stem for 64-px input."""

    def __init__(self, c=48):
        super().__init__()
        self.stem = nn.Sequential(nn.Conv2d(1, c, 3, 2, 1, bias=False), nn.BatchNorm2d(c), nn.ReLU())
        self.body = nn.Sequential(
            Block(c, c, 1),
            Block(c, 2 * c, 2),
            Block(2 * c, 4 * c, 2),
            Block(4 * c, 4 * c, 1),
            Block(4 * c, 6 * c, 2),
            Block(6 * c, 6 * c, (2, 1)),
        )
        self.channels = 6 * c

    def forward(self, x):
        return self.body(self.stem(x))


class Timm(nn.Module):
    def __init__(self, name, pretrained):
        super().__init__()
        import timm

        self.net = timm.create_model(name, pretrained=pretrained, in_chans=1, num_classes=0, global_pool="")
        self.channels = self.net.num_features

    def forward(self, x):
        # ImageNet's grey level and spread, as the pretrained weights expect.
        return self.net.forward_features((x - 0.45) / 0.226)


TIMM = {"resnet18": "resnet18.a1_in1k", "convnext_atto": "convnext_atto.d2_in1k", "mobilenetv4_conv_small": "mobilenetv4_conv_small.e2400_r224_in1k"}


class Fingerprint(nn.Module):
    """A 64x256 ink window in, a unit-length fingerprint out."""

    def __init__(self, arch, dim, pretrained):
        super().__init__()
        self.backbone = Ours() if arch == "ours" else Timm(TIMM[arch], pretrained)
        rows = 2
        self.norm = nn.LayerNorm(self.backbone.channels * rows)
        self.head = nn.Linear(self.backbone.channels * rows, dim)
        self.dim = dim

    def forward(self, x):
        y = self.backbone(x)
        # Rows of a 48-px window are pooled to 2 as well, so every height gives the same size.
        y = F.adaptive_avg_pool2d(y, (2, 1)).flatten(1)
        return F.normalize(self.head(self.norm(y.float())), dim=1)


class CosFace(nn.Module):
    def __init__(self, dim, classes, s=30.0, m=0.2):
        super().__init__()
        self.w = nn.Parameter(torch.randn(classes, dim) * 0.01)
        self.s, self.m = s, m

    def logits(self, emb):
        return emb.float() @ F.normalize(self.w.float(), dim=1).t()

    def forward(self, emb, labels):
        cos = self.logits(emb)
        cos = cos - self.m * F.one_hot(labels, cos.shape[1]).float()
        return F.cross_entropy(self.s * cos, labels)


# ---------------------------------------------------------------- data


def load_set(path):
    meta = json.load(open(os.path.join(path, "meta.json")))
    h, w = meta["height"], meta["width"]
    strips = np.memmap(os.path.join(path, "strips.u8"), dtype=np.uint8, mode="r").reshape(-1, h, w)
    widths = np.fromfile(os.path.join(path, "widths.u16"), dtype=np.uint16).astype(np.int64)
    labels = np.fromfile(os.path.join(path, "labels.u16"), dtype=np.uint16).astype(np.int64)
    return meta, strips, widths, labels


def merge_groups(probe_dir, faces, threshold, dev):
    """Faces whose probes are near-identical (cosine >= threshold, same probe script) share a class."""
    meta = json.load(open(os.path.join(probe_dir, "meta.json")))
    assert meta["faces"] == faces, "the probes must list the training faces"
    p = np.fromfile(os.path.join(probe_dir, "probes.u8"), dtype=np.uint8).reshape(len(faces), -1)
    scripts = np.array(meta["scripts"])
    parent = list(range(len(faces)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    x = F.normalize(torch.from_numpy(p).to(dev).half().float(), dim=1).half()
    for s in range(0, len(faces), 1024):
        sim = (x[s : s + 1024] @ x.t()).float()
        rows, cols = torch.where(sim >= threshold)
        for i, j in zip((rows + s).tolist(), cols.tolist()):
            if i < j and scripts[i] == scripts[j]:
                parent[find(i)] = find(j)
    roots = sorted({find(i) for i in range(len(faces))})
    index = {r: k for k, r in enumerate(roots)}
    return np.array([index[find(i)] for i in range(len(faces))], dtype=np.int64)


class Batches:
    """Batches of sample indices, half of them confusable classes once mining starts, read from the
    mapped sets by a few threads ahead of the GPU."""

    def __init__(self, parts, owner, row, widths, classes, batch, seed, threads=6, depth=8):
        self.parts, self.owner, self.row, self.widths, self.classes, self.batch = parts, owner, row, widths, classes, batch
        self.rng = np.random.default_rng(seed)
        self.by_class = None
        self.neighbours = None
        self.threads, self.depth = threads, depth

    def set_neighbours(self, neighbours):
        if self.by_class is None:
            order = np.argsort(self.classes, kind="stable")
            bounds = np.searchsorted(self.classes[order], np.arange(self.classes.max() + 2))
            self.by_class = [order[bounds[c] : bounds[c + 1]] for c in range(self.classes.max() + 1)]
        self.neighbours = neighbours

    def epoch_indices(self):
        perm = self.rng.permutation(len(self.classes))
        out = []
        for s in range(0, len(perm) - self.batch + 1, self.batch):
            idx = perm[s : s + self.batch]
            if self.neighbours is not None:
                # Half the batch: groups of a random class and its 3 nearest, 2 samples each.
                half = self.batch // 2
                groups = half // 8
                anchors = self.rng.integers(0, len(self.by_class), groups)
                picked = []
                for a in anchors:
                    for c in [a, *self.rng.choice(self.neighbours[a], 3, replace=False)]:
                        pool = self.by_class[c]
                        if len(pool):
                            picked.extend(self.rng.choice(pool, 2))
                idx = np.concatenate([idx[: self.batch - len(picked)], np.array(picked, dtype=np.int64)])
            out.append(idx)
        return out

    def gather(self, idx):
        h, w = self.parts[0][1].shape[1:]
        out = np.empty((len(idx), h, w), dtype=np.uint8)
        for k, part in enumerate(self.parts):
            sel = np.where(self.owner[idx] == k)[0]
            if len(sel):
                rows = self.row[idx[sel]]
                order = np.argsort(rows)
                out[sel[order]] = part[1][rows[order]]
        return out

    def __iter__(self):
        batches = self.epoch_indices()
        q = queue.Queue(self.depth)
        todo = queue.Queue()
        for i, b in enumerate(batches):
            todo.put((i, b))
        done = {}
        lock = threading.Condition()

        def work():
            while True:
                try:
                    i, b = todo.get_nowait()
                except queue.Empty:
                    return
                strips = torch.from_numpy(self.gather(b)).pin_memory()
                with lock:
                    while i - next_out[0] >= self.depth:
                        lock.wait()
                    done[i] = (b, strips)
                    lock.notify_all()

        next_out = [0]
        workers = [threading.Thread(target=work, daemon=True) for _ in range(self.threads)]
        for t in workers:
            t.start()
        for i in range(len(batches)):
            with lock:
                while i not in done:
                    lock.wait()
                item = done.pop(i)
                next_out[0] = i + 1
                lock.notify_all()
            yield item


# ---------------------------------------------------------------- training


def save_atomic(obj, path):
    tmp = path + ".tmp"
    torch.save(obj, tmp)
    os.replace(tmp, path)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--arch", default="ours", choices=["ours", *TIMM])
    p.add_argument("--scratch", action="store_true", help="timm backbones from random weights")
    p.add_argument("--data", required=True)
    p.add_argument("--proto", default="samples/lib64-proto8")
    p.add_argument("--val", default="samples/lib64-val4r")
    p.add_argument("--dev", default="samples/own-dev64,samples/lica-dev64,samples/synthetic-dev64")
    p.add_argument("--probes", default="samples/lib-probes")
    p.add_argument("--merge", type=float, default=0.995, help="probe cosine at which faces merge; 0 merges none")
    p.add_argument("--dim", type=int, default=512)
    p.add_argument("--epochs", type=int, default=16)
    p.add_argument("--batch", type=int, default=256)
    p.add_argument("--lr", type=float, default=None)
    p.add_argument("--wd", type=float, default=0.05)
    p.add_argument("--family-weight", type=float, default=0.3)
    p.add_argument("--mine-from", type=int, default=3, help="epoch (1-based) from which confusable batches start; 0 never")
    p.add_argument("--small-frac", type=float, default=0.3, help="share of epochs at 48-px windows")
    p.add_argument("--ema", type=float, default=0.9995)
    p.add_argument("--teacher", default=None, help="a trained run's folder to distil from")
    p.add_argument("--temperature", type=float, default=2.0)
    p.add_argument("--max-steps", type=int, default=0, help="stop after this many steps (timing)")
    p.add_argument("--seed", type=int, default=0)
    p.add_argument("--out", required=True)
    a = p.parse_args()
    os.makedirs(a.out, exist_ok=True)
    dev = torch.device("cuda")
    torch.backends.cudnn.benchmark = True
    torch.backends.cuda.matmul.allow_tf32 = True
    torch.backends.cudnn.allow_tf32 = True
    torch.manual_seed(a.seed)
    pretrained = a.arch != "ours" and not a.scratch
    lr = a.lr or (1e-3 if pretrained else 2e-3)

    parts = [load_set(d) for d in a.data.split(",")]
    faces = parts[0][0]["faces"]
    assert all(q[0]["faces"] == faces for q in parts), "the sample sets must list the same faces"
    owner = np.concatenate([np.full(len(q[3]), k) for k, q in enumerate(parts)])
    row = np.concatenate([np.arange(len(q[3])) for q in parts])
    widths = np.concatenate([q[2] for q in parts])
    labels = np.concatenate([q[3] for q in parts])
    group = merge_groups(a.probes, faces, a.merge, dev) if a.merge > 0 else np.arange(len(faces))
    classes = group[labels]
    nclass = int(group.max()) + 1
    fam_names = sorted({f.split("|")[0] for f in faces})
    fam_index = {f: i for i, f in enumerate(fam_names)}
    face_family = np.array([fam_index[f.split("|")[0]] for f in faces])
    print(json.dumps({"samples": int(len(labels)), "faces": len(faces), "classes": nclass, "families": len(fam_names)}), flush=True)

    model = Fingerprint(a.arch, a.dim, pretrained).to(dev).to(memory_format=torch.channels_last)
    ema = Fingerprint(a.arch, a.dim, False).to(dev).to(memory_format=torch.channels_last)
    ema.load_state_dict(model.state_dict())
    ema.eval().requires_grad_(False)
    head = CosFace(a.dim, nclass).to(dev)
    fam_head = CosFace(a.dim, len(fam_names)).to(dev)
    teacher = None
    if a.teacher:
        targs = json.load(open(os.path.join(a.teacher, "run.json")))["args"]
        teacher = Fingerprint(targs["arch"], targs["dim"], False).to(dev).to(memory_format=torch.channels_last)
        teacher.load_state_dict(torch.load(os.path.join(a.teacher, "best.pt"), map_location=dev)["model"])
        teacher.eval().requires_grad_(False)
        thead = CosFace(targs["dim"], nclass).to(dev)
        thead.load_state_dict(torch.load(os.path.join(a.teacher, "best.pt"), map_location=dev)["head"])
        thead.requires_grad_(False)

    backbone = list(model.backbone.parameters())
    rest = [*model.norm.parameters(), *model.head.parameters(), *head.parameters(), *fam_head.parameters()]
    opt = torch.optim.AdamW([{"params": backbone}, {"params": rest}], lr=lr, weight_decay=a.wd)
    steps_per_epoch = len(labels) // a.batch
    total = a.epochs * steps_per_epoch
    warm = max(1, int(0.03 * total))

    def lr_at(step):
        if step < warm:
            return step / warm
        return 0.5 * (1 + math.cos(math.pi * (step - warm) / max(1, total - warm)))

    batches = Batches([(q[0], q[1]) for q in parts], owner, row, widths, classes, a.batch, a.seed)
    evaluator = Evaluator(a.proto, a.val, a.dev.split(",") if a.dev else [], faces, dev)
    gen = torch.Generator(device=dev)
    gen.manual_seed(a.seed)
    widths_t = torch.from_numpy(widths).to(dev)
    classes_t = torch.from_numpy(classes).to(dev)
    family_t = torch.from_numpy(face_family).to(dev)
    labels_t = torch.from_numpy(labels).to(dev)

    start_epoch, step, log = 0, 0, []
    last = os.path.join(a.out, "last.pt")
    if os.path.exists(last):
        st = torch.load(last, map_location=dev, weights_only=False)
        model.load_state_dict(st["model"])
        ema.load_state_dict(st["ema"])
        head.load_state_dict(st["head"])
        fam_head.load_state_dict(st["fam_head"])
        opt.load_state_dict(st["opt"])
        start_epoch, step, log = st["epoch"], st["step"], st["log"]
        gen.set_state(st["gen"].to("cpu") if hasattr(st["gen"], "to") else st["gen"])
        batches.rng = np.random.default_rng(a.seed + 1000 * start_epoch)
        print(json.dumps({"resumed_at_epoch": start_epoch}), flush=True)
    json.dump({"args": vars(a), "faces": len(faces), "classes": nclass}, open(os.path.join(a.out, "run.json"), "w"), indent=1)
    np.save(os.path.join(a.out, "group.npy"), group)

    started = time.time()
    for epoch in range(start_epoch, a.epochs):
        model.train()
        head_only = pretrained and epoch == 0 and not teacher
        for prm in backbone:
            prm.requires_grad_(not head_only)
        if a.mine_from and epoch + 1 >= a.mine_from:
            with torch.no_grad():
                w = F.normalize(head.w.float(), dim=1)
                near = []
                for s in range(0, nclass, 2048):
                    sim = w[s : s + 2048] @ w.t()
                    sim[torch.arange(sim.shape[0]), torch.arange(s, s + sim.shape[0])] = -2
                    near.append(sim.topk(8, dim=1).indices.cpu().numpy())
            batches.set_neighbours(np.concatenate(near))
        height = 48 if epoch < round(a.small_frac * a.epochs) else 64
        seen, total_loss, t0 = 0, 0.0, time.time()
        for idx, strips in batches:
            idx_t = torch.from_numpy(idx).to(dev)
            x = crop_windows(strips.to(dev, non_blocking=True), widths_t[idx_t], gen, WIN)
            x = augment_batch(x, gen)
            if height != H:
                x = F.interpolate(x, size=(height, height * 4), mode="area")
            x = x.contiguous(memory_format=torch.channels_last)
            f = lr_at(step)
            opt.param_groups[0]["lr"] = lr * f * (0 if head_only else 1)
            opt.param_groups[1]["lr"] = lr * f if not head_only else lr
            with torch.autocast("cuda", dtype=torch.bfloat16):
                emb = model(x)
            if teacher is not None:
                with torch.no_grad(), torch.autocast("cuda", dtype=torch.bfloat16):
                    temb = teacher(x)
                t_logits = thead.s * thead.logits(temb) / a.temperature
                s_logits = head.s * head.logits(emb) / a.temperature
                loss = F.kl_div(F.log_softmax(s_logits, 1), F.log_softmax(t_logits, 1), log_target=True, reduction="batchmean") * a.temperature**2
            else:
                loss = head(emb, classes_t[idx_t]) + a.family_weight * fam_head(emb, family_t[labels_t[idx_t]])
            opt.zero_grad(set_to_none=True)
            loss.backward()
            opt.step()
            with torch.no_grad():
                d = min(a.ema, (1 + step) / (10 + step))
                for pe, pm in zip(ema.parameters(), model.parameters()):
                    pe.lerp_(pm, 1 - d)
                for be, bm in zip(ema.buffers(), model.buffers()):
                    be.copy_(bm)
            step += 1
            seen += len(idx)
            total_loss += loss.item() * len(idx)
            if a.max_steps and step >= a.max_steps:
                print(json.dumps({"steps": step, "samples_per_s": seen / (time.time() - t0)}), flush=True)
                return
        entry = {"epoch": epoch + 1, "height": height, "loss": total_loss / max(1, seen), "seconds": time.time() - started, "epoch_seconds": time.time() - t0}
        entry.update(evaluator.run(ema))
        log.append(entry)
        print(json.dumps(entry), flush=True)
        save_atomic({"model": ema.state_dict(), "head": head.state_dict(), "epoch": epoch + 1, "metrics": entry}, os.path.join(a.out, f"epoch-{epoch + 1:02d}.pt"))
        save_atomic(
            {
                "model": model.state_dict(),
                "ema": ema.state_dict(),
                "head": head.state_dict(),
                "fam_head": fam_head.state_dict(),
                "opt": opt.state_dict(),
                "epoch": epoch + 1,
                "step": step,
                "log": log,
                "gen": gen.get_state(),
            },
            last,
        )
        json.dump(log, open(os.path.join(a.out, "log.json"), "w"), indent=1)
    print(json.dumps({"done": True, "seconds": time.time() - started}), flush=True)


if __name__ == "__main__":
    main()
