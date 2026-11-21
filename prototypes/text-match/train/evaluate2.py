"""PROTOTYPE. Measures a 64-px fingerprint model the way the matcher uses it: each face is known by the mean
fingerprint of its gallery samples (nearest class mean), and a block by the mean over the windows of all
its lines. Reports face and family top-1 and top-25 on the realistic development sets (exported by
src/export-strips.ts) and strip-level top-1 on a realistic validation sample set."""

import json
import os

import numpy as np
import torch
import torch.nn.functional as F

H, WIN = 64, 256


def windows_of(strip, width, win=WIN):
    """The windows a strip is read in at match time (src/fingerprint.ts windowsOf)."""
    h = strip.shape[0]
    if width <= win:
        out = np.zeros((h, win), dtype=np.uint8)
        out[:, :width] = strip[:, :width]
        return [out]
    starts = list(range(0, width - win + 1, win // 2))
    if starts[-1] != width - win:
        starts.append(width - win)
    return [strip[:, s : s + win] for s in starts]


def squeeze_strip(strip, width, factor):
    """The strip scaled across by `factor` (a test-time view)."""
    if factor == 1:
        return strip, width
    t = torch.from_numpy(np.ascontiguousarray(strip[:, :width])).float()[None, None]
    nw = max(1, round(width * factor))
    out = F.interpolate(t, size=(strip.shape[0], nw), mode="area" if factor < 1 else "bilinear", align_corners=None if factor < 1 else False)
    return out[0, 0].round().clamp(0, 255).byte().numpy(), nw


@torch.no_grad()
def embed_groups(model, strips, widths, owners, n_groups, dev, views=(1.0,), batch=1024, win=WIN):
    """One unit fingerprint per group (a face's sample, or a block): the mean over its strips' windows."""
    model.eval()
    wins, owner = [], []
    for i in range(len(widths)):
        for f in views:
            s, w = squeeze_strip(strips[i], int(widths[i]), f)
            for x in windows_of(s, w, win):
                wins.append(x)
                owner.append(owners[i])
    wins = np.stack(wins)
    owner = torch.tensor(owner, device=dev)
    out = None
    for s in range(0, len(wins), batch):
        x = torch.from_numpy(wins[s : s + batch]).to(dev).float().div(255).unsqueeze(1)
        if x.is_cuda:
            x = x.contiguous(memory_format=torch.channels_last)
        with torch.autocast("cuda", dtype=torch.bfloat16, enabled=x.is_cuda):
            e = model(x).float()
        if out is None:
            out = torch.zeros(n_groups, e.shape[1], device=dev)
        out.index_add_(0, owner[s : s + batch], e)
    return F.normalize(out, dim=1)


def load_samples(path):
    meta = json.load(open(os.path.join(path, "meta.json")))
    strips = np.memmap(os.path.join(path, "strips.u8"), dtype=np.uint8, mode="r").reshape(-1, meta["height"], meta["width"])
    widths = np.fromfile(os.path.join(path, "widths.u16"), dtype=np.uint16).astype(np.int64)
    labels = np.fromfile(os.path.join(path, "labels.u16"), dtype=np.uint16).astype(np.int64) if os.path.exists(os.path.join(path, "labels.u16")) else None
    return meta, strips, widths, labels


class Evaluator:
    def __init__(self, proto, val, devs, faces, dev, val_n=6000, group=None, win=WIN):
        self.dev = dev
        self.win = win
        self.faces = faces
        self.family = np.array([f.split("|")[0] for f in faces])
        self.group = group
        pm, ps, pw, pl = load_samples(proto)
        assert pm["faces"] == faces, "the gallery must list the training faces"
        self.proto = (np.asarray(ps), pw, pl)
        self.val = None
        if val:
            vm, vs, vw, vl = load_samples(val)
            pick = np.sort(np.random.default_rng(0).choice(len(vl), min(val_n, len(vl)), replace=False))
            self.val = (np.asarray(vs[pick]), vw[pick], vl[pick])
        self.devs = []
        for d in devs:
            m, s, w, _ = load_samples(d)
            assert m["faces"] == faces, f"{d} must list the training faces"
            owners = np.concatenate([np.full(b["count"], k) for k, b in enumerate(m["blocks"])]).astype(np.int64)
            labels = np.array([b["label"] for b in m["blocks"]])
            fams = np.array([b["family"] for b in m["blocks"]])
            self.devs.append((m["set"], np.asarray(s), w, owners, labels, fams))

    def gallery(self, model, views=(1.0,)):
        s, w, l = self.proto
        e = embed_groups(model, s, w, np.arange(len(w)), len(w), self.dev, views, win=self.win)
        means = torch.zeros(len(self.faces), e.shape[1], device=self.dev).index_add_(0, torch.from_numpy(l).to(self.dev), e)
        return F.normalize(means, dim=1)

    def scores(self, order, labels, fams, prefix):
        res = {}
        for k in (1, 25):
            top = order[:, :k]
            known = labels >= 0
            res[f"{prefix}face{k}"] = float(np.mean([labels[i] in top[i] for i in np.where(known)[0]])) if known.any() else float("nan")
            res[f"{prefix}fam{k}"] = float(np.mean([fams[i] in set(self.family[top[i]]) for i in range(len(labels))]))
            if self.group is not None and k == 1 and known.any():
                res[f"{prefix}twin1"] = float(np.mean([self.group[labels[i]] == self.group[top[i, 0]] for i in np.where(known)[0]]))
        return res

    @torch.no_grad()
    def run(self, model, views=(1.0,), gallery=None, project=None):
        g = self.gallery(model) if gallery is None else gallery
        if project is not None:
            g = F.normalize(project(g), dim=1)
        res = {}
        for name, s, w, owners, labels, fams in self.devs:
            e = embed_groups(model, s, w, owners, len(labels), self.dev, views, win=self.win)
            if project is not None:
                e = F.normalize(project(e), dim=1)
            order = (e @ g.t()).topk(25, dim=1).indices.cpu().numpy()
            res.update(self.scores(order, labels, fams, f"{name}_"))
        if self.val is not None:
            s, w, l = self.val
            e = embed_groups(model, s, w, np.arange(len(w)), len(w), self.dev, views, win=self.win)
            if project is not None:
                e = F.normalize(project(e), dim=1)
            order = (e @ g.t()).topk(25, dim=1).indices.cpu().numpy()
            res.update(self.scores(order, l, self.family[l], "val_"))
        keys = [k for k in ("own_face1", "own_fam1", "lica_face1", "lica_fam1") if k in res]
        res["select"] = float(np.mean([res[k] for k in keys])) if keys else float("nan")
        return res
