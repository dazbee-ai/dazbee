"""PROTOTYPE, never merged. Times an exported classifier natively (onnxruntime on the CPU, the
fast tokenizer from tokenizer.json), one request at a time, as a server would run it; with only
onnxruntime, tokenizers and numpy installed.

  python bench_native.py <run>/onnx <queries .jsonl or test.frozen.txt> [threads]
"""
import json
import os
import sys
import time

import numpy as np

try:
    import resource
except ImportError:  # Windows
    resource = None
import onnxruntime as ort
from tokenizers import Tokenizer


def queries(path):
    if path.endswith(".txt"):
        out = []
        for line in open(path, encoding="utf-8"):
            if " | " in line and not line.startswith("#"):
                out.append(line.split(" | ", 1)[1].strip())
        return out
    return [json.loads(l)["query"] for l in open(path, encoding="utf-8")]


def main():
    d, qpath = sys.argv[1], sys.argv[2]
    threads = int(sys.argv[3]) if len(sys.argv) > 3 else 1
    peak = (lambda: resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024) if resource else (lambda: 0)
    rss0 = peak()
    meta = json.load(open(os.path.join(d, "labels.json")))
    tok = Tokenizer.from_file(os.path.join(d, "tokenizer.json"))
    tok.enable_truncation(meta["max_len"])
    so = ort.SessionOptions()
    so.intra_op_num_threads = threads
    so.inter_op_num_threads = 1
    t = time.perf_counter()
    sess = ort.InferenceSession(os.path.join(d, "model.int8.onnx"), so, providers=["CPUExecutionProvider"])
    load_ms = (time.perf_counter() - t) * 1000
    qs = queries(qpath)

    def run(q):
        e = tok.encode(q)
        feed = {"input_ids": np.array([e.ids], dtype=np.int64),
                "attention_mask": np.array([e.attention_mask], dtype=np.int64)}
        if "token_type_ids" in meta["inputs"]:
            feed["token_type_ids"] = np.array([e.type_ids], dtype=np.int64)
        return int(np.argmax(sess.run(None, feed)[0][0]))

    for q in qs[:10]:
        run(q)
    ms = []
    for q in qs:
        t = time.perf_counter()
        run(q)
        ms.append((time.perf_counter() - t) * 1000)
    ms.sort()
    print(json.dumps({"engine": f"onnxruntime {ort.__version__} native", "threads": threads, "requests": len(ms),
                      "load_ms": round(load_ms), "ms_median": round(ms[len(ms) // 2], 2),
                      "ms_p95": round(ms[int(len(ms) * 0.95)], 2),
                      "peak_rss_growth_mb": round(peak() - rss0) if resource else None}))


if __name__ == "__main__":
    main()
