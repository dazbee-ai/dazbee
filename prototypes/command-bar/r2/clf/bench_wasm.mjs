// PROTOTYPE, never merged. Runs an exported classifier in Node through onnxruntime-web's
// WebAssembly engine (what a browser tab would run) on the frozen test set's requests: checks its
// classes against the Python int8 run, and times tokenizing plus one forward pass per request.
//
//   node bench_wasm.mjs <run>/onnx <run>/test-int8.jsonl [threads] [classes out .jsonl]
// (needs onnxruntime-web and @huggingface/transformers installed where node resolves them)
import fs from "node:fs";
import path from "node:path";
import * as ort from "onnxruntime-web";
import { AutoTokenizer, env } from "@huggingface/transformers";

const [dir, resultsPath, threadsArg, predsPath] = process.argv.slice(2);
ort.env.wasm.numThreads = Number(threadsArg || 1);
env.allowRemoteModels = false;
env.localModelPath = path.dirname(path.resolve(dir));
const meta = JSON.parse(fs.readFileSync(path.join(dir, "labels.json"), "utf8"));
const rows = fs.readFileSync(resultsPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));

const rss0 = process.memoryUsage().rss;
const t0 = performance.now();
const tok = await AutoTokenizer.from_pretrained(path.basename(path.resolve(dir)));
const session = await ort.InferenceSession.create(fs.readFileSync(path.join(dir, "model.int8.onnx")), {
  executionProviders: ["wasm"],
  graphOptimizationLevel: "all",
});
const loadMs = performance.now() - t0;

function feeds(text) {
  const enc = tok(text, { truncation: true, max_length: meta.max_len });
  const out = {};
  for (const name of meta.inputs) {
    const t = enc[name] ?? enc.input_ids.map(() => 0n);
    const data = BigInt64Array.from(Array.from(t.data, (v) => BigInt(v)));
    out[name] = new ort.Tensor("int64", data, [1, data.length]);
  }
  return out;
}

for (const r of rows.slice(0, 10)) await session.run(feeds(r.query)); // warm up
const times = [];
let agree = 0;
const preds = [];
for (const r of rows) {
  const t = performance.now();
  const out = await session.run(feeds(r.query));
  const logits = out.logits.data;
  let best = 0;
  for (let i = 1; i < logits.length; i++) if (logits[i] > logits[best]) best = i;
  times.push(performance.now() - t);
  if (meta.labels[best] === r.pred) agree++;
  preds.push(JSON.stringify({ query: r.query, pred: meta.labels[best] }));
}
if (predsPath) fs.writeFileSync(predsPath, preds.join("\n") + "\n");
times.sort((a, b) => a - b);
const q = (p) => times[Math.min(times.length - 1, Math.floor(p * times.length))];
console.log(JSON.stringify({
  engine: "onnxruntime-web wasm", threads: ort.env.wasm.numThreads, requests: rows.length,
  same_class_as_python: agree / rows.length, load_ms: Math.round(loadMs),
  ms_median: +q(0.5).toFixed(2), ms_p95: +q(0.95).toFixed(2),
  model_mb: +(fs.statSync(path.join(dir, "model.int8.onnx")).size / 1e6).toFixed(1),
  rss_growth_mb: Math.round((process.memoryUsage().rss - rss0) / 1e6),
}));
