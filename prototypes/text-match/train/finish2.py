"""PROTOTYPE. Finishes a round 3 run: picks its checkpoint by the realistic development sets (never the loss),
tries the extras on them (a gallery of clean or realistic samples or both, test-time views at other
squeezes, AdaBN on unlabelled test-ad development blocks, fewer fingerprint numbers by PCA), exports the
chosen model to ONNX with its fingerprints, makes a static int8 copy (QDQ, per channel, calibrated on
realistic samples) with fingerprints rebuilt by it, and measures both copies on the same sets.

    python train/finish2.py --run models/r3-resnet18 [--epoch 9] [--steps all|choose|export|int8]
Writes <run>/best.pt, model.onnx, model.json, fingerprints.f32, fingerprint-faces.json, twins.json,
model.int8.onnx, fingerprints-int8.f32 (and fingerprint-faces-int8.json), finish.json.
"""

import argparse
import copy
import json
import os
import time

import numpy as np
import torch
import torch.nn.functional as F

from evaluate2 import Evaluator, embed_groups, load_samples, windows_of
from train2 import H, WIN, CosFace, Fingerprint

VIEWS = {"1": (1.0,), "3": (0.9, 1.0, 1.1), "3w": (0.85, 1.0, 1.15)}


def adabn(model, strips, widths, dev):
    """Batch statistics recomputed on unlabelled real windows (cumulative average), weights kept."""
    m = copy.deepcopy(model)
    bns = [x for x in m.modules() if isinstance(x, torch.nn.BatchNorm2d)]
    if not bns:
        return None
    for b in bns:
        b.reset_running_stats()
        b.momentum = None
    wins = np.stack([w for i in range(len(widths)) for w in windows_of(strips[i], int(widths[i]))])
    m.train()
    with torch.no_grad():
        for s in range(0, len(wins), 128):
            x = torch.from_numpy(wins[s : s + 128]).to(dev).float().div(255).unsqueeze(1).contiguous(memory_format=torch.channels_last)
            m(x)
    return m.eval()


def gallery_of(ev, model, sets, faces, dev):
    """Face means over one or more sample sets (clean, realistic or both)."""
    total = None
    for path in sets:
        meta, s, w, l = load_samples(path)
        e = embed_groups(model, np.asarray(s), w, np.arange(len(w)), len(w), dev)
        g = torch.zeros(len(faces), e.shape[1], device=dev).index_add_(0, torch.from_numpy(l).to(dev), e)
        total = g if total is None else total + g
    return F.normalize(total, dim=1)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--run", required=True)
    p.add_argument("--epoch", type=int, default=0)
    p.add_argument("--steps", default="all")
    p.add_argument("--clean", default="samples/lib64-proto8")
    p.add_argument("--real", default="samples/lib64-proto8r")
    p.add_argument("--val", default="samples/lib64-val4r")
    p.add_argument("--dev", default="samples/own-dev64,samples/lica-dev64,samples/synthetic-dev64")
    p.add_argument("--adabn", default="samples/testads-dev64")
    p.add_argument("--calib", default="samples/lib64-val4r")
    p.add_argument("--device", default="cuda")
    p.add_argument("--no-val", action="store_true", help="leave the strip-level validation set out (a CPU export)")
    p.add_argument("--no-gallery", action="store_true", help="the ONNX copies only, for their size and speed")
    a = p.parse_args()
    dev = torch.device(a.device)
    run = json.load(open(os.path.join(a.run, "run.json")))
    args = run["args"]
    log = json.load(open(os.path.join(a.run, "log.json")))
    epoch = a.epoch or max(log, key=lambda e: e["select"])["epoch"]
    st = torch.load(os.path.join(a.run, f"epoch-{epoch:02d}.pt"), map_location=dev, weights_only=False)
    model = Fingerprint(args["arch"], args["dim"], False).to(dev).to(memory_format=torch.channels_last)
    model.load_state_dict(st["model"])
    model.eval()
    faces = json.load(open(os.path.join(args["proto"], "meta.json")))["faces"]
    group = np.load(os.path.join(a.run, "group.npy"))
    ev = Evaluator(a.clean, None if a.no_val else a.val, a.dev.split(",") if a.dev else [], faces, dev, group=group)
    out_path = os.path.join(a.run, "finish.json")
    out = json.load(open(out_path)) if os.path.exists(out_path) else {}
    out.update({"epoch": epoch, "checkpoint_metrics": st["metrics"]})
    steps = a.steps.split(",")

    if "all" in steps or "choose" in steps:
        res = {}
        g_clean = gallery_of(ev, model, [a.clean], faces, dev)
        g_real = gallery_of(ev, model, [a.real], faces, dev)
        g_both = gallery_of(ev, model, [a.clean, a.real], faces, dev)
        for name, g in (("clean", g_clean), ("real", g_real), ("both", g_both)):
            res[f"gallery={name}"] = ev.run(model, gallery=g)
        best_g = max(("clean", "real", "both"), key=lambda n: res[f"gallery={n}"]["select"])
        g_best = {"clean": g_clean, "real": g_real, "both": g_both}[best_g]
        for v in ("3", "3w"):
            res[f"views={v}"] = ev.run(model, views=VIEWS[v], gallery=g_best)
        meta, s, w, _ = load_samples(a.adabn)
        ad = adabn(model, np.asarray(s), w, dev)
        if ad is not None:
            sets = {"clean": [a.clean], "real": [a.real], "both": [a.clean, a.real]}[best_g]
            res["adabn"] = ev.run(ad, gallery=gallery_of(ev, ad, sets, faces, dev))
        # Fewer numbers: the gallery's principal directions (fitted on the gallery itself).
        mean = g_best.mean(0, keepdim=True)
        u, sv, vt = torch.linalg.svd(g_best - mean, full_matrices=False)
        for d in (128, 256):
            if d < g_best.shape[1]:
                proj = vt[:d].t()
                res[f"pca={d}"] = ev.run(model, gallery=g_best, project=lambda x, proj=proj, mean=mean: (x - mean) @ proj)
        out["choose"] = {"best_gallery": best_g, **res}
        json.dump(out, open(out_path, "w"), indent=1)
        print(json.dumps({k: {m: round(v, 4) for m, v in r.items() if isinstance(v, float)} for k, r in res.items()}), flush=True)

    if "all" in steps or "export" in steps:
        best_g = out.get("choose", {}).get("best_gallery", "clean")
        sets = {"clean": [a.clean], "real": [a.real], "both": [a.clean, a.real]}[best_g]
        torch.save({"model": model.state_dict(), "head": st["head"], "epoch": epoch}, os.path.join(a.run, "best.pt"))
        if not a.no_gallery:
            g = gallery_of(ev, model, sets, faces, dev)
            g.cpu().numpy().astype("float32").tofile(os.path.join(a.run, "fingerprints.f32"))
            json.dump(faces, open(os.path.join(a.run, "fingerprint-faces.json"), "w"))
        twins = {}
        for i, gi in enumerate(group.tolist()):
            twins.setdefault(gi, []).append(faces[i])
        json.dump([v for v in twins.values() if len(v) > 1], open(os.path.join(a.run, "twins.json"), "w"))
        json.dump({"height": H, "window": WIN, "dim": args["dim"]}, open(os.path.join(a.run, "model.json"), "w"))
        cpu = copy.deepcopy(model).float().cpu().to(memory_format=torch.contiguous_format)
        torch.onnx.export(
            cpu,
            torch.zeros(1, 1, H, WIN),
            os.path.join(a.run, "model.onnx"),
            input_names=["ink"],
            output_names=["fingerprint"],
            dynamic_axes={"ink": {0: "n"}, "fingerprint": {0: "n"}},
            opset_version=17,
            dynamo=False,
        )
        out["export"] = {"onnx_bytes": os.path.getsize(os.path.join(a.run, "model.onnx")), "gallery": best_g, "params": sum(x.numel() for x in model.parameters())}
        json.dump(out, open(out_path, "w"), indent=1)
        print(json.dumps(out["export"]), flush=True)

    if "all" in steps or "int8" in steps:
        import onnxruntime as ort
        from onnxruntime.quantization import CalibrationDataReader, QuantFormat, QuantType, quantize_static
        from onnxruntime.quantization.shape_inference import quant_pre_process

        src = os.path.join(a.run, "model.onnx")
        pre = os.path.join(a.run, "model.pre.onnx")
        dst = os.path.join(a.run, "model.int8.onnx")
        quant_pre_process(src, pre)
        meta, s, w, _ = load_samples(a.calib)
        pick = np.random.default_rng(1).choice(len(w), 512, replace=False)
        calib = np.stack([windows_of(np.asarray(s[i]), int(w[i]))[0] for i in pick]).astype(np.float32)[:, None] / 255

        class Reader(CalibrationDataReader):
            def __init__(self):
                self.batches = iter([{"ink": calib[k : k + 16]} for k in range(0, len(calib), 16)])

            def get_next(self):
                return next(self.batches, None)

        quantize_static(pre, dst, Reader(), quant_format=QuantFormat.QDQ, per_channel=True, activation_type=QuantType.QInt8, weight_type=QuantType.QInt8)
        os.remove(pre)
        if a.no_gallery:
            out["int8"] = {"bytes": os.path.getsize(dst)}
            json.dump(out, open(out_path, "w"), indent=1)
            print(json.dumps(out["int8"]), flush=True)
            return
        opts = ort.SessionOptions()
        opts.intra_op_num_threads = 14
        sess = ort.InferenceSession(dst, opts, providers=["CPUExecutionProvider"])

        class OrtModel(torch.nn.Module):
            """The int8 ONNX copy behind the PyTorch call the evaluator makes."""

            def forward(self, x):
                y = sess.run(None, {"ink": x.float().contiguous().cpu().numpy()})[0]
                return torch.from_numpy(y).to(x.device)

        om = OrtModel()
        best_g = out.get("export", {}).get("gallery", "clean")
        sets = {"clean": [a.clean], "real": [a.real], "both": [a.clean, a.real]}[best_g]
        t = time.time()
        g8 = gallery_of(ev, om, sets, faces, dev)
        g8.cpu().numpy().astype("float32").tofile(os.path.join(a.run, "fingerprints-int8.f32"))
        json.dump(faces, open(os.path.join(a.run, "fingerprint-faces-int8.json"), "w"))
        res8 = ev.run(om, gallery=g8)
        res32 = ev.run(model, gallery=gallery_of(ev, model, sets, faces, dev))
        out["int8"] = {"bytes": os.path.getsize(dst), "gallery_seconds": time.time() - t, "int8": res8, "float": res32}
        json.dump(out, open(out_path, "w"), indent=1)
        print(json.dumps({"int8_select": res8["select"], "float_select": res32["select"], "bytes": out["int8"]["bytes"]}), flush=True)


if __name__ == "__main__":
    main()
