"""PROTOTYPE. Makes an int8 copy of a fingerprint model for the CPU (onnxruntime dynamic quantisation of
its convolutions and matrix products) and measures what it costs: size, speed on one thread, and how
often its nearest face over the held-out strips agrees with the full-precision model's.

    python train/quantize.py --model models/big-w48-p96 --val samples/lib-val6 --n 3000
"""

import argparse
import json
import os
import time

import numpy as np
import onnxruntime as ort
from onnxruntime.quantization import QuantType, quantize_dynamic

from train import load, windows


def embed(sess, strips, widths):
    out = []
    for s, w in zip(strips, widths):
        win = np.stack(windows(s, int(w))).astype(np.float32)[:, None] / 255
        v = sess.run(None, {"ink": win})[0].mean(0)
        out.append(v / np.linalg.norm(v))
    return np.stack(out)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--model", required=True)
    p.add_argument("--val", required=True)
    p.add_argument("--n", type=int, default=3000)
    a = p.parse_args()
    src = os.path.join(a.model, "model.onnx")
    dst = os.path.join(a.model, "model.int8.onnx")
    quantize_dynamic(src, dst, weight_type=QuantType.QInt8)
    opts = ort.SessionOptions()
    opts.intra_op_num_threads = 1
    full = ort.InferenceSession(src, opts, providers=["CPUExecutionProvider"])
    small = ort.InferenceSession(dst, opts, providers=["CPUExecutionProvider"])
    _, strips, widths, labels = load(a.val)
    pick = np.random.default_rng(0).choice(len(labels), a.n, replace=False)
    protos = np.fromfile(os.path.join(a.model, "fingerprints.f32"), dtype=np.float32).reshape(-1, 128)
    res = {"bytes_full": os.path.getsize(src), "bytes_int8": os.path.getsize(dst)}
    for name, sess in (("full", full), ("int8", small)):
        t = time.time()
        e = embed(sess, strips[pick], widths[pick])
        res[f"{name}_ms_per_strip"] = (time.time() - t) * 1000 / a.n
        res[f"{name}_top1"] = float(np.mean((e @ protos.T).argmax(1) == labels[pick]))
        res[f"{name}_nearest"] = (e @ protos.T).argmax(1)
    res["same_nearest"] = float(np.mean(res.pop("full_nearest") == res.pop("int8_nearest")))
    print(json.dumps(res))


if __name__ == "__main__":
    main()
