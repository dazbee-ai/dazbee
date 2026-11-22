"""PROTOTYPE, never merged. Exports a trained classifier to ONNX, quantizes its weights to 8 bits
(dynamic int8, as onnxruntime-web runs it in a browser), and scores the int8 model on the frozen
test set: exact outcome, the right outcome in the top two, refusals, confidence, speed and size.

  python export_eval.py --run runs/minilm12            writes runs/minilm12/onnx/ and test results
"""
import argparse
import json
import os
import sys
import time

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))

from outcomes import DEFAULTS, LABELS, NONE, read_test  # noqa: E402
from slots import value_for  # noqa: E402


def _shape_infer_in_memory():
    """onnxruntime's quantizer saves the model with external data to infer shapes; onnx 1.23's
    external-data writer hangs on some of these models on Windows. They are far below protobuf's
    2 GB limit, so shapes are inferred in memory instead."""
    import onnx
    from onnxruntime.quantization import base_quantizer, onnx_quantizer, quant_utils, quantize

    def infer(model):
        if not isinstance(model, onnx.ModelProto):
            model = onnx.load(str(model))
        out = onnx.shape_inference.infer_shapes(model)
        quant_utils.add_infer_metadata(out)
        return out

    for module in (base_quantizer, onnx_quantizer, quant_utils, quantize):
        module.save_and_reload_model_with_shape_infer = infer


def export(run, max_len=64):
    import torch
    from onnxruntime.quantization import QuantType, quantize_dynamic
    from transformers import AutoModelForSequenceClassification, AutoTokenizer
    src = os.path.join(run, "best")
    out = os.path.join(run, "onnx")
    os.makedirs(out, exist_ok=True)
    tok = AutoTokenizer.from_pretrained(src)
    model = AutoModelForSequenceClassification.from_pretrained(src).eval()
    enc = tok(["make the logo bigger"], return_tensors="pt", padding="max_length", max_length=16)
    names = [k for k in ("input_ids", "attention_mask", "token_type_ids") if k in enc]

    class Wrap(torch.nn.Module):
        def __init__(self, m):
            super().__init__()
            self.m = m

        def forward(self, *xs):
            return self.m(**dict(zip(names, xs))).logits

    fp32 = os.path.join(out, "model.onnx")
    torch.onnx.export(Wrap(model), tuple(enc[k] for k in names), fp32, input_names=names,
                      output_names=["logits"], opset_version=17, dynamo=False,
                      dynamic_axes={**{k: {0: "b", 1: "t"} for k in names}, "logits": {0: "b"}})
    q = os.path.join(out, "model.int8.onnx")
    _shape_infer_in_memory()
    quantize_dynamic(fp32, q, weight_type=QuantType.QInt8, per_channel=True)
    tok.save_pretrained(out)
    json.dump({"labels": LABELS, "inputs": names, "max_len": max_len}, open(os.path.join(out, "labels.json"), "w"))
    return fp32, q, tok, names


def auroc(scores, labels):
    pos = [s for s, l in zip(scores, labels) if l]
    neg = [s for s, l in zip(scores, labels) if not l]
    if not pos or not neg:
        return None
    wins = sum((p > n) + 0.5 * (p == n) for p in pos for n in neg)
    return wins / (len(pos) * len(neg))


def score(path, tok, names, rows, threads=1):
    import onnxruntime as ort
    so = ort.SessionOptions()
    so.intra_op_num_threads = threads
    so.inter_op_num_threads = 1
    sess = ort.InferenceSession(path, so, providers=["CPUExecutionProvider"])
    out, times = [], []
    for r in rows:
        t = time.perf_counter()
        enc = tok([r["query"]], return_tensors="np", truncation=True, max_length=64)
        feed = {k: enc[k].astype(np.int64) for k in names}
        logits = sess.run(None, feed)[0][0]
        times.append((time.perf_counter() - t) * 1000)
        p = np.exp(logits - logits.max())
        p /= p.sum()
        order = np.argsort(-p)
        top = [LABELS[i] for i in order[:2]]

        def ok(cls):
            if cls != r["cls"]:
                return False
            if cls == NONE:
                return True
            v = value_for(r["query"], cls)
            v = v if v is not None else DEFAULTS.get(cls)
            g = r["value"] if r["value"] is not None else DEFAULTS.get(cls)
            return v == g

        out.append({"query": r["query"], "gold": r["cls"], "value": r["value"], "style": r["style"],
                    "category": r["category"], "pred": top[0], "second": top[1],
                    "pred_value": value_for(r["query"], top[0]), "conf": float(p[order[0]]),
                    "margin": float(p[order[0]] - p[order[1]]),
                    "exact": ok(top[0]), "top2": ok(top[0]) or ok(top[1])})
    return out, times


def summary(res, times):
    n = len(res)
    acts = [r for r in res if r["gold"] != NONE]
    nos = [r for r in res if r["gold"] == NONE]
    by_style = {}
    for r in res:
        by_style.setdefault(r["style"], []).append(r["exact"])
    s = {"n": n, "exact": sum(r["exact"] for r in res) / n, "top2": sum(r["top2"] for r in res) / n,
         "actions_exact": sum(r["exact"] for r in acts) / len(acts),
         "actions_top2": sum(r["top2"] for r in acts) / len(acts),
         "refusals": sum(r["exact"] for r in nos) / len(nos),
         "acted_on_refusal": sum(r["pred"] != NONE for r in nos) / len(nos),
         "refused_action": sum(r["pred"] == NONE for r in acts) / len(acts),
         "auroc": auroc([r["conf"] for r in res], [r["exact"] for r in res]),
         "by_style": {k: round(sum(v) / len(v), 4) for k, v in by_style.items()},
         "ms_median": float(np.median(times)), "ms_p95": float(np.percentile(times, 95))}
    # Acting alone at a confidence threshold: share acted on, wrong share of those.
    curve = []
    for t in (0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 0.98):
        acted = [r for r in res if r["pred"] != NONE and r["conf"] >= t]
        curve.append({"t": t, "acts": len(acted) / n,
                      "wrong": (sum(not r["exact"] for r in acted) / len(acted)) if acted else 0.0})
    s["curve"] = curve
    return s


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--run", required=True)
    ap.add_argument("--threads", type=int, default=1)
    ap.add_argument("--no-export", action="store_true")
    args = ap.parse_args()
    rows = read_test()
    if args.no_export:
        from transformers import AutoTokenizer
        out = os.path.join(args.run, "onnx")
        tok = AutoTokenizer.from_pretrained(out)
        names = json.load(open(os.path.join(out, "labels.json")))["inputs"]
        fp32, q = os.path.join(out, "model.onnx"), os.path.join(out, "model.int8.onnx")
    else:
        fp32, q, tok, names = export(args.run)
    report = {"run": args.run, "bytes_fp32": os.path.getsize(fp32), "bytes_int8": os.path.getsize(q)}
    rows2 = read_test(os.path.join(os.path.dirname(HERE), "data", "test2.frozen.txt"))
    for tag, path, rs in (("int8", q, rows), ("fp32", fp32, rows), ("int8_test2", q, rows2)):
        res, times = score(path, tok, names, rs, args.threads)
        report[tag] = summary(res, times)
        with open(os.path.join(args.run, f"test-{tag}.jsonl"), "w", encoding="utf-8") as f:
            for r in res:
                f.write(json.dumps(r, ensure_ascii=False) + "\n")
    # The threshold for acting alone, chosen on validation (wrong actions at most 1% of those
    # acted on, most requests acted on), then applied to both test sets.
    from data import load
    _, val = load()
    vrows = [{"query": r["query"], "cls": r["cls"], "value": r["value"], "style": r["source"],
              "category": r["category"]} for r in val]
    vres, _ = score(q, tok, names, vrows, args.threads)
    best_t = 1.01
    for t in [x / 100 for x in range(30, 100)]:
        acted = [r for r in vres if r["pred"] != NONE and r["conf"] >= t]
        if acted and sum(not r["exact"] for r in acted) / len(acted) <= 0.01:
            best_t = t
            break
    report["threshold"] = best_t
    for tag in ("int8", "int8_test2"):
        res = [json.loads(l) for l in open(os.path.join(args.run, f"test-{tag}.jsonl"), encoding="utf-8")]
        acted = [r for r in res if r["pred"] != NONE and r["conf"] >= best_t]
        report[tag]["at_threshold"] = {"acts": len(acted) / len(res),
                                       "wrong": sum(not r["exact"] for r in acted) / max(len(acted), 1)}
    json.dump(report, open(os.path.join(args.run, "test-report.json"), "w"), indent=1)
    s = report["int8"]
    print(json.dumps({"run": args.run, "int8_MB": round(report["bytes_int8"] / 1e6, 1),
                      "exact": round(s["exact"], 4), "top2": round(s["top2"], 4),
                      "refusals": round(s["refusals"], 4), "auroc": s["auroc"] and round(s["auroc"], 3),
                      "ms": round(s["ms_median"], 2), "fp32_exact": round(report["fp32"]["exact"], 4),
                      "test2_exact": round(report["int8_test2"]["exact"], 4), "threshold": best_t,
                      "at_t": s["at_threshold"], "test2_at_t": report["int8_test2"]["at_threshold"],
                      "by_style": s["by_style"]}), flush=True)


if __name__ == "__main__":
    main()
