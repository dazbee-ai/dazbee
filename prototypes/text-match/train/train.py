"""PROTOTYPE. Trains the font fingerprint model on samples drawn by Dazbee's renderer (src/make-samples.ts).

One command, on CUDA when there is a card, else the CPU:

    python train/train.py --data .data/samples/train48 --val .data/samples/val6 --proto .data/samples/proto8 \
        --per-face 48 --width 32 --epochs 30 --out .data/models/w32-p48

The model is a small residual CNN that turns a 32x128 window of a line's ink into a 128-number
fingerprint, trained with a cosine-margin loss over the faces (CosFace). At match time a face is
known by the mean fingerprint of a few of its samples (nearest class mean), so a face added later
(a brand's upload) needs only its samples drawn and embedded, never a new training run.

Writes <out>/model.onnx (the fingerprint model), <out>/metrics.json (held-out top-k accuracy, sizes,
times) and <out>/model.pt.
"""

import argparse
import json
import math
import os
import time

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

H, W_STRIP, WIN = 32, 320, 128


def load(path, per_face=None):
    meta = json.load(open(os.path.join(path, "meta.json")))
    strips = np.fromfile(os.path.join(path, "strips.u8"), dtype=np.uint8).reshape(-1, H, W_STRIP)
    widths = np.fromfile(os.path.join(path, "widths.u16"), dtype=np.uint16).astype(np.int64)
    labels = np.fromfile(os.path.join(path, "labels.u16"), dtype=np.uint16).astype(np.int64)
    if per_face:
        keep = np.zeros(len(labels), dtype=bool)
        seen = {}
        for i, l in enumerate(labels):
            seen[l] = seen.get(l, 0) + 1
            keep[i] = seen[l] <= per_face
        strips, widths, labels = strips[keep], widths[keep], labels[keep]
    return meta, strips, widths, labels


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


class Fingerprint(nn.Module):
    """32x128 ink window in, a unit-length fingerprint out."""

    def __init__(self, width=32, dim=128):
        super().__init__()
        c = width
        self.stem = nn.Sequential(nn.Conv2d(1, c, 3, 1, 1, bias=False), nn.BatchNorm2d(c), nn.ReLU())
        self.body = nn.Sequential(
            Block(c, c, 1),
            Block(c, 2 * c, 2),  # 16x64
            Block(2 * c, 4 * c, 2),  # 8x32
            Block(4 * c, 4 * c, 1),
            Block(4 * c, 6 * c, 2),  # 4x16
            Block(6 * c, 6 * c, (2, 1)),  # 2x16
        )
        self.head = nn.Linear(6 * c * 2, dim)

    def forward(self, x):
        y = self.body(self.stem(x))
        # Mean over the width keeps each height row: where the strokes sit up and down matters.
        y = y.mean(dim=3).flatten(1)
        return F.normalize(self.head(y), dim=1)


class CosFace(nn.Module):
    def __init__(self, dim, classes, s=30.0, m=0.25):
        super().__init__()
        self.w = nn.Parameter(torch.randn(classes, dim) * 0.01)
        self.s, self.m = s, m

    def forward(self, emb, labels):
        cos = emb @ F.normalize(self.w, dim=1).t()
        onehot = F.one_hot(labels, cos.shape[1]).float()
        return F.cross_entropy(self.s * (cos - self.m * onehot), labels)


def windows(strip, width):
    """The windows a strip is read in at match time, as src/fingerprint.ts cuts them."""
    if width <= WIN:
        out = np.zeros((H, WIN), dtype=np.uint8)
        out[:, :width] = strip[:, :width]
        return [out]
    starts = list(range(0, width - WIN + 1, WIN // 2))
    if starts[-1] != width - WIN:
        starts.append(width - WIN)
    return [strip[:, s : s + WIN] for s in starts]


def augment(x, gen):
    """Makes clean renders look like generated ads: blur, lost resolution, noise, faded ink, small slant."""
    n = x.shape[0]
    dev = x.device
    # Height jitter: the ink box found in a block is a pixel or two off.
    scale = 1 + (torch.rand(n, device=dev, generator=gen) - 0.5) * 0.16
    shear = (torch.rand(n, device=dev, generator=gen) - 0.5) * 0.08
    shift = (torch.rand(n, 2, device=dev, generator=gen) - 0.5) * torch.tensor([0.04, 0.08], device=dev)
    theta = torch.zeros(n, 2, 3, device=dev)
    theta[:, 0, 0] = 1
    theta[:, 0, 1] = shear
    theta[:, 1, 1] = scale
    theta[:, :, 2] = shift
    x = F.grid_sample(x, F.affine_grid(theta, x.shape, align_corners=False), align_corners=False)
    # Lost resolution: down to 10 to 32 pixels high and back.
    low = torch.rand(n, device=dev, generator=gen) < 0.5
    if low.any():
        h = int(torch.randint(10, 32, (1,), device=dev, generator=gen).item())
        small = F.interpolate(x[low], size=(h, max(8, round(WIN * h / H))), mode="area")
        x[low] = F.interpolate(small, size=(H, WIN), mode="bilinear", align_corners=False)
    # Blur.
    sig = torch.rand(n, device=dev, generator=gen) * 1.2
    k = torch.arange(-3, 4, device=dev).float()
    ker = torch.exp(-(k[None] ** 2) / (2 * sig[:, None].clamp(min=0.05) ** 2))
    ker = ker / ker.sum(1, keepdim=True)
    xb = x.transpose(0, 1)  # 1, n, H, W: one group per sample
    xb = F.conv2d(F.pad(xb, (3, 3, 0, 0), mode="replicate"), ker[:, None, None, :], groups=n)
    xb = F.conv2d(F.pad(xb, (0, 0, 3, 3), mode="replicate"), ker[:, None, :, None], groups=n)
    x = xb.transpose(0, 1)
    # Faded or harsh ink, and noise.
    gamma = torch.exp((torch.rand(n, 1, 1, 1, device=dev, generator=gen) - 0.5) * 0.9)
    peak = 0.55 + 0.45 * torch.rand(n, 1, 1, 1, device=dev, generator=gen)
    x = x.clamp(0, 1) ** gamma * peak
    x = x + torch.randn(x.shape, device=dev, generator=gen) * (torch.rand(n, 1, 1, 1, device=dev, generator=gen) * 0.08)
    return x.clamp(0, 1)


def crops(strips, widths, gen, dev):
    """A random window of each strip; short strips sit at the left half the time, as at match time."""
    n = strips.shape[0]
    w = widths.float()
    u = torch.rand(n, device=dev, generator=gen)
    long_start = (u * (w - WIN + 1).clamp(min=1)).floor()
    pad = torch.where(torch.rand(n, device=dev, generator=gen) < 0.5, torch.zeros_like(w), (u * (WIN - w + 1).clamp(min=1)).floor())
    start = torch.where(w > WIN, long_start, -pad).long()
    src = start[:, None] + torch.arange(WIN, device=dev)[None]
    valid = (src >= 0) & (src < widths[:, None])
    cols = src.clamp(0, W_STRIP - 1)
    out = torch.gather(strips, 2, cols[:, None, :].expand(n, H, WIN)).float().div(255) * valid[:, None, :]
    return out[:, None]


@torch.no_grad()
def embed_strips(model, strips, widths, dev, batch=1024):
    """One fingerprint per strip: the mean of its windows' fingerprints, made unit length."""
    model.eval()
    wins, owner = [], []
    for i in range(len(strips)):
        for w in windows(strips[i], int(widths[i])):
            wins.append(w)
            owner.append(i)
    wins = np.stack(wins)
    owner = torch.tensor(owner, device=dev)
    out = torch.zeros(len(strips), model.head.out_features, device=dev)
    for s in range(0, len(wins), batch):
        x = torch.from_numpy(wins[s : s + batch]).to(dev).float().div(255).unsqueeze(1)
        out.index_add_(0, owner[s : s + batch], model(x))
    return F.normalize(out, dim=1)


@torch.no_grad()
def evaluate(model, proto, val, dev):
    """Held-out top-k by nearest class mean over the faces of the prototype set (Dazbee's catalogue)."""
    pmeta, ps, pw, pl = proto
    vmeta, vs, vw, vl = val
    faces = pmeta["faces"]
    assert vmeta["faces"] == faces, "the validation and prototype sets must list the same faces"
    pe = embed_strips(model, ps, pw, dev)
    nface = len(faces)
    means = torch.zeros(nface, pe.shape[1], device=dev).index_add_(0, torch.from_numpy(pl).to(dev), pe)
    means = F.normalize(means, dim=1)
    ve = embed_strips(model, vs, vw, dev)
    sim = ve @ means.t()
    order = sim.argsort(dim=1, descending=True).cpu().numpy()
    family = np.array([f.split("|")[0] for f in faces])
    res = {}
    for k in (1, 5, 25):
        res[f"face_top{k}"] = float(np.mean([vl[i] in order[i, :k] for i in range(len(vl))]))
        res[f"family_top{k}"] = float(
            np.mean([family[vl[i]] in set(family[order[i, :k]]) for i in range(len(vl))])
        )
    return res


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--data", required=True)
    p.add_argument("--val", required=True)
    p.add_argument("--proto", required=True)
    p.add_argument("--per-face", type=int, default=None)
    p.add_argument("--width", type=int, default=32)
    p.add_argument("--dim", type=int, default=128)
    p.add_argument("--epochs", type=int, default=30)
    p.add_argument("--batch", type=int, default=256)
    p.add_argument("--lr", type=float, default=2e-3)
    p.add_argument("--seed", type=int, default=0)
    p.add_argument("--amp", type=int, default=1, help="half precision on CUDA (1) or full (0)")
    p.add_argument("--out", required=True)
    p.add_argument("--device", default="cuda" if torch.cuda.is_available() else "cpu")
    a = p.parse_args()
    os.makedirs(a.out, exist_ok=True)
    torch.manual_seed(a.seed)
    dev = torch.device(a.device)
    meta, strips, widths, labels = load(a.data, a.per_face)
    faces = meta["faces"]
    val = load(a.val)
    proto = load(a.proto)
    model = Fingerprint(a.width, a.dim).to(dev)
    head = CosFace(a.dim, len(faces)).to(dev)
    params = sum(p.numel() for p in model.parameters())
    opt = torch.optim.AdamW(list(model.parameters()) + list(head.parameters()), lr=a.lr, weight_decay=5e-4)
    steps = a.epochs * math.ceil(len(labels) / a.batch)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=a.lr, total_steps=steps, pct_start=0.1)
    scaler = torch.amp.GradScaler(enabled=a.amp and dev.type == "cuda")
    torch.backends.cudnn.benchmark = True
    gen = torch.Generator(device=dev)
    gen.manual_seed(a.seed)
    strips_t = torch.from_numpy(strips).to(dev)  # uint8: a quarter of the memory; made 0..1 per batch
    labels_t = torch.from_numpy(labels).to(dev)
    widths_t = torch.from_numpy(widths).to(dev)
    started = time.time()
    log = []
    for epoch in range(a.epochs):
        model.train()
        perm = torch.randperm(len(labels), device=dev, generator=gen)
        total = 0.0
        for s in range(0, len(perm), a.batch):
            idx = perm[s : s + a.batch]
            x = augment(crops(strips_t[idx], widths_t[idx], gen, dev), gen)
            with torch.autocast(dev.type, dtype=torch.float16, enabled=a.amp and dev.type == "cuda"):
                loss = head(model(x).float(), labels_t[idx])
            opt.zero_grad()
            scaler.scale(loss).backward()
            scaler.step(opt)
            scaler.update()
            sched.step()
            total += loss.item() * len(idx)
        entry = {"epoch": epoch + 1, "loss": total / len(labels), "seconds": time.time() - started}
        if epoch + 1 == a.epochs:
            entry.update(evaluate(model, proto, val, dev))
        log.append(entry)
        print(json.dumps(entry), flush=True)
    train_seconds = time.time() - started
    model.eval().cpu()
    torch.save(model.state_dict(), os.path.join(a.out, "model.pt"))
    onnx_path = os.path.join(a.out, "model.onnx")
    torch.onnx.export(
        model,
        torch.zeros(1, 1, H, WIN),
        onnx_path,
        input_names=["ink"],
        output_names=["fingerprint"],
        dynamic_axes={"ink": {0: "n"}, "fingerprint": {0: "n"}},
        opset_version=17,
        dynamo=False,
    )
    final = log[-1]
    json.dump(
        {
            "args": vars(a),
            "params": params,
            "onnx_bytes": os.path.getsize(onnx_path),
            "train_samples": int(len(labels)),
            "faces": len(faces),
            "train_seconds": train_seconds,
            "device": str(dev) + (f" ({torch.cuda.get_device_name(0)})" if dev.type == "cuda" else ""),
            "final": final,
            "log": log,
        },
        open(os.path.join(a.out, "metrics.json"), "w"),
        indent=1,
    )


if __name__ == "__main__":
    main()
