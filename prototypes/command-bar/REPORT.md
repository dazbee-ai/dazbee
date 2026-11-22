# Quick command bar: prototype report

PROTOTYPE, never merged; branch `command-bar-prototype`. Every number below was measured on
the files in this folder (the raw engine results stay on the training machine); where each
comes from is named next to it. Round 1 (Needle 3) written 2026-11-21, round 2 2026-11-22.

# Round 2 (2026-11-22): a small classifier instead of Needle

## Answer

**A small text classifier is far better than Needle for this bar: 96.6% exact on a new frozen
test set (96.0% on a second one), against 68.0% for round 1's Needle LoRA and 68.2% for Needle
trained on the same new data. It is 23 MB and takes 1.2 ms a request natively and 3.1 ms in
WebAssembly (one thread, envy).** It is MiniLM-L6 (`sentence-transformers/all-MiniLM-L6-v2`,
22.7M parameters, Apache-2.0), fine-tuned to pick one of 82 outcomes or "no call". A short rule
file (`r2/slots.py`) reads the number or hex code from the request. It is one model with one
forward pass: no router, no second turn, no tool prompt, and no engine repair step to work
around.

Recommendation: build the bar on the MiniLM-L6 classifier, not on Needle. Let it act alone at
or above the confidence threshold chosen on validation (0.79). On the test set that acts on 82%
of requests, 1.0% of them wrong; on the second test set 82.5%, 1.8% wrong. Below the threshold,
show its best two guesses as buttons: the right outcome is among the top two for 98.8% of test
requests. Log what people type and which button they press, and retrain on it; the training run
takes 15 minutes on a laptop GPU.

How I picked it: by validation alone, MiniLM-L12 seed 0 was best (97.3% against 97.0%, 7 of
1,945 requests). On the first test set the two tie at 96.6%. MiniLM-L6 is ahead on the second
test set (96.0% against 94.5%) and in the browser engine (96.6% against 96.0%). It has
confidence that separates right from wrong far better (AUROC 0.95 against 0.86), is two-thirds
the size and is twice as fast. Speed and memory come after accuracy, and accuracy is a tie
within noise, so I chose MiniLM-L6 (Claude, 2026-11-22). MiniLM-L12 is the fallback; the code
and numbers for both are here.

The goals, measured on the new frozen test set (`r2/data/test.frozen.txt`, 500 requests):

| goal, in order                  | target                     | round 1 Needle LoRA     | round 2 classifier (MiniLM-L6)                       |
| ------------------------------- | -------------------------- | ----------------------- | ---------------------------------------------------- |
| 1. exact call                   | well above 75.8%, aim ~90% | 68.0%                   | **96.6%** (second test set: 96.0%)                   |
| 2. right outcome in the top two | ≥95%                       | –                       | **98.8%** (second test set: 98.5%)                   |
| 3. one engine instead of six    | one, ~175 MB in a browser  | six, 1.1 GB WebAssembly | **one model**, +175 MB Node memory, library included |
| 4. size                         | ≤63.5 MB                   | 63.5 MB (4-bit)         | **23.2 MB** (int8)                                   |

Before and after, every model on the same two frozen test sets (exact outcome; each row is the
8-bit or 4-bit file that would ship, unless a float32 score is named):

| model                                                  | data    | test exact               | top two | refusals | Hinglish | indirect | second test set | size     |
| ------------------------------------------------------ | ------- | ------------------------ | ------- | -------- | -------- | -------- | --------------- | -------- |
| Needle, untrained, round 1 schema (two turns)          | –       | 35.2%                    | –       | 86.2%    | 8.8%     | 22.2%    | –               | 63.5 MB  |
| Needle, round 1 LoRA r16, round 1 schema               | round 1 | 68.0%                    | –       | 78.5%    | 36.8%    | 55.6%    | –               | 63.5 MB  |
| Needle, round 2 LoRA r16, one-turn schema (one engine) | v2      | 68.2%                    | –       | 70.8%    | 48.5%    | 55.6%    | 65.5%           | 63.4 MB  |
| MiniLM-L12 classifier                                  | v1      | 94.6%                    | 97.6%   | 93.8%    | 80.9%    | 91.1%    | 91.0%           | 34.2 MB  |
| MiniLM-L12 classifier                                  | v2      | 96.6%                    | 99.2%   | 98.5%    | 95.6%    | 93.3%    | 94.5%           | 34.2 MB  |
| Ettin-32M classifier (MIT)                             | v2      | 33.2% (96.6% in float32) | 41.4%   | 73.8%    | 5.9%     | 28.9%    | 29.5%           | 32.7 MB  |
| bge-small classifier (MIT)                             | v3      | 95.8%                    | 98.2%   | 98.5%    | 95.6%    | 82.2%    | 95.5%           | 34.2 MB  |
| MiniLM-L12 classifier, seed 0 (best on validation)     | v3      | 96.6%                    | 98.2%   | 96.9%    | 94.1%    | 86.7%    | 94.5%           | 34.2 MB  |
| MiniLM-L12 classifier, seed 1                          | v3      | 97.4%                    | 98.8%   | 98.5%    | 94.1%    | 91.1%    | 96.0%           | 34.2 MB  |
| MiniLM-L12 classifier, seed 2                          | v3      | 96.6%                    | 98.6%   | 96.9%    | 97.1%    | 88.9%    | 95.5%           | 34.2 MB  |
| **MiniLM-L6 classifier (recommended)**                 | v3      | **96.6%**                | 98.8%   | 98.5%    | 97.1%    | 88.9%    | **96.0%**       | 23.2 MB  |
| SmolLM2-135M as a classifier (Apache-2.0)              | v3      | 91.6% (94.2% in float32) | 96.2%   | 96.9%    | 80.9%    | 86.7%    | 94.0%           | 137.5 MB |
| Qwen3-0.6B, LoRA r16, as a classifier (Apache-2.0)     | v3      | 88.2% (95.0% in float32) | 95.2%   | 93.8%    | 77.9%    | 91.1%    | 87.0%           | 600 MB   |

Data: v1 is the first 10.1k generated requests plus round 1's templates. v2 fixes a labelling
bug and adds 4.6k Hinglish and implied-fix requests. v3 rewrites two more mislabelled batches
(section R3). Needle round 2 and the v2 MiniLM-L12 row trained on the same data, so they compare
like for like. Refusals are the 65 test requests that need no call; Hinglish (68) and indirect
(45) are the test set's hardest styles. Each test request is worth 0.2 points, each request on
the second set 0.5. Results: `r2/reports/`.

## R1. The two test sets

`r2/data/test.frozen.txt`: 500 requests I wrote by hand on 2026-11-22. I committed them
(`87d5722`) before any training data was generated, and no model trained on them. The styles:
casual 125, short 62, misspelt 71, Hinglish 68, marketer talk 64, indirect (the fix is implied:
"the logo is way too small") 45. Plus 65 no-call requests (13%): generative asks, unrelated
chat, edits the bar doesn't have, vague edits, negations and two edits at once. Every one of
the 82 outcomes appears at least once. Each line is `outcome code | request`.
`r2/outcomes.py` turns a code into round 1's call, with defaults filled in: "bigger" and "20%
bigger" run the same command, so they count as the same outcome.

`r2/data/test2.frozen.txt`: 200 more requests in the same style mix, written and committed
(`e20d8b6`) after the first classifier had been scored on the first set. That was before any
model trained on the data changes that the first set's errors led to (section R3). It checks
that those changes don't just fit the first set. They held: the first classifier scored 91.0%
on it, the final ones 94.5-96.0%.

Values: a code's number is the one the request names. Where it names none, the tool's default
applies (resize 20%, corners 16 px, nudge 10 px). "Double" is +100% and "half" is -50%. The
value rule (`r2/slots.py`) reads the right value on all 435 action requests of the first set
when it is given the right class. I wrote it after the test set and checked it once, with no
changes after.

## R2. Free fixes on Needle (no training)

`r2/schemas.py` has four schemas for the same 82 outcomes, each with a mapping back to round 1's
calls. `r2/score_needle.py` scores them through the real engine (cactus-compute 4.2.6, native,
four processes), reading the call from the reasoning line as in round 1:

| schema                                                                                                         | untrained Needle | round 1 LoRA r16 |
| -------------------------------------------------------------------------------------------------------------- | ---------------- | ---------------- |
| `r1`: round 1's two turns and names                                                                            | 35.2%            | 68.0%            |
| `words`: the same two turns, names as people type them, no shared prefixes, no area named "text", defaults set | 35.4%            | 28.0%            |
| `flat24`: all 24 tools in one engine (Needle then retrieves five)                                              | 29.8%            | 26.4%            |
| `one`: one turn, five tools, the edit as an enum option and an optional number                                 | 31.6%            | 25.4%            |

The renames, defaults and ranges in the schema bought nothing measurable (+0.2 points, one
request). The round 1 LoRA drops to 25-28% with any new names, because it learned the old ones.
The one-turn schema is worth having only for speed and memory (one engine), and only once
trained (section R4).

## R3. Data

**Through the ChatGPT plan only.** `r2/gen_plan.py` calls the owner's ChatGPT plan through
`chatgpt_plan.py`'s sign-in (passed as `--plan-script`, outside this repository). It used no API
key and no paid API. Every row was written by **gpt-6.2-sol** at low reasoning effort, and each
row records that in its `model` field. 14,843 rows in `r2/data/gen/`, one file per class and
batch. Each call asks for 50 requests for one outcome. It describes the edit precisely, names
four of eight styles to mix (casual, terse, misspelt, Hinglish, marketer jargon, implied fix,
question, long or spoken), and lists the numbers or hex codes to use. Every row is checked: the
value it names must be written in the request and be in range; a request that should name no
number must have none; and it must not equal a request in either test set. About 98% of the
rows passed (10,126 of 10,399 in the first run, 4,619 of 4,649 in the second, 99 of 100 in the
rewrite).

Validation is a fixed tenth of the generated rows, picked by a hash of the request, plus round
1's validation split. Round 1's other templated splits are added to training (4,311 rows).
Final training set: 17,420 requests, 13% no call (`r2/clf/data.py`).

**Two bugs in the generated data and one targeted addition, all found from errors:**

- v1 → v2, bug: the "big" no-call kind (generative asks) shared its key with the outcome "big"
  (bigger), so its prompt asked for "make it bigger" and 300 such rows were labelled no call.
  That was most of v1's misses on "bigger". Rewritten.
- v1 → v2, addition: one batch per class asking mainly for Hinglish and implied fixes, with a
  list of everyday Hindi words (`HINGLISH_FROM`, 4.6k rows). I added it because Hinglish was
  the weakest style on the first test set (81%). That choice was guided by the test set, which
  is why the second test set exists: on it, Hinglish went from 85% to 96-100%.
- v2 → v3, bug: an example Hinglish phrase in the style hint ("ise zara upar le jao", move it
  up) led two "unsupported edit" batches to write 100 move and delete requests labelled no
  call. That caused "nudge it up a little" to be refused. The hint now has no example phrases,
  and the batches were rewritten.

## R4. Models

**Classifiers** (`r2/clf/train_clf.py`): the encoder plus a linear head over 83 labels (82
outcomes and no call). AdamW, lr 8e-5, cosine schedule, batch 32, 15 epochs, label smoothing
0.1. Training adds typing noise on the fly: a swapped, dropped, doubled or wrong letter in a
quarter of requests, plus lowercase and caps changes. It saves state every epoch, and the epoch
with the best validation exact share is kept. One run is 11-30 minutes on this laptop's GTX 1650,
depending on what else runs. `r2/clf/export_eval.py` exports to ONNX, quantizes the weights to
8 bits (onnxruntime's dynamic int8, per channel) and scores the int8 file.

- **MiniLM-L6** (22.7M, Apache-2.0), recommended: validation 97.0%. On test 96.6% in int8 and
  96.8% in float32. Confidence AUROC is 0.95, the best of all models here. 23.2 MB int8.
- **MiniLM-L12** (33M, Apache-2.0): best on validation (97.3%, seed 0). The int8 file scores
  96.6% on test, against 96.0% for the float32 one. 34.2 MB.
- **Seeds**: three seeds of MiniLM-L12 on v3 score 96.6%, 97.4% and 96.6% on test, and 94.5%,
  96.0% and 95.5% on the second set. A seed moves the score by about a point, so differences
  under a point between models are noise. I chose between models on validation (and, for
  L6 against L12, on size and speed; see the answer), never on the best test score.
- **bge-small-en-v1.5** (33M, MIT): close, 95.8% / 95.5% on the two sets, but weaker on
  implied fixes (82%).
- **Ettin-32M** (2025, ModernBERT design, MIT): as good in float32 (96.6%), but standard int8
  quantization breaks it (33.2%). Unsigned, not per-channel int8 brings it back to 94.6% on
  test, still 2 points below its float32. Not worth it over MiniLM.
- **Small decoder language models as classifiers** (the same head on the last token, trained
  on envy's GPU in float32): SmolLM2-135M full fine-tune, 6 epochs, validation 95.4%; Qwen3-0.6B
  LoRA r16, 3 epochs, validation 97.0%. In float32 they score 94.2% and 95.0% on test, below
  the MiniLMs. int8 costs them more (91.6% and 88.2%), and they are 6 and 26 times MiniLM-L6's
  size (137.5 and 600 MB int8; 8 and 22 ms a request on one envy core, against 1.2 ms). A first
  SmolLM run learned nothing (15% on validation): transformers 5 loads these models in bfloat16
  by default, where AdamW's small steps vanish. Loading in float32 fixed it. FunctionGemma-270M
  and LFM2 were not tried: larger decoders had already lost to MiniLM.

**Needle round 2** (`r2/needle_rows.py`, `train_lora.py --keep-epochs`, `r2/pick_epochs.sh`,
`r2/after_needle.sh`): trained exactly as served. The same five-tool one-turn schema and
compact tools JSON the engine sends, a reasoning line then the call, and one request per row.
That makes one engine and no router. LoRA r16 (alpha 32, lr 1e-4) on q/k/v/gate/out of all 20
layers with the 4-bit weights simulated in the loss, batch 16, sequences of 800 tokens (the
tools prompt alone is about 650). The run takes 31 minutes an epoch on envy's RTX 4070 Super,
and I ran 4 epochs. Every epoch's adapter was exported at 4 bits and scored by the engine on
800 validation requests: 54.4%, 61.0%, 64.6%, 64.4%. Epoch 3 was kept. On test it scores 68.2%
with the reasoning-line call and 58.4% with the engine's repaired call; on the second set
65.5%. Its errors are mostly the wrong option of the right tool ("vertically center" read as
align center, "move down one step in the stack" as move down) and wrong refusals. Cactus
advises 10-30 epochs. More epochs would help, but not enough to close 30 points on a curve
that had already flattened. Rank 32 and the two-turn `words` schema were not trained: the
classifier settled the question first, and each Needle epoch costs half an hour.

## R5. Confidence and acting alone

The classifier's confidence is its top softmax probability. AUROC between right and wrong
calls, MiniLM-L6: 0.95 on test and 0.92 on the second set (MiniLM-L12 seed 0: 0.86 and 0.88).
For comparison, Needle's head in round 1 scored 0.82 and the engine's own score 0.50. Each
model's threshold was chosen on validation as the lowest at which at most 1% of the actions it
takes are wrong: 0.79 for MiniLM-L6, 0.85 for MiniLM-L12. Applied to the test sets:

| model, set              | acts alone on | wrong share of those | right outcome in the two buttons, all requests |
| ----------------------- | ------------- | -------------------- | ---------------------------------------------- |
| MiniLM-L6, test (500)   | 82.0%         | 1.0% (4 of 410)      | 98.8%                                          |
| MiniLM-L6, second (200) | 82.5%         | 1.8% (3 of 165)      | 98.5%                                          |
| MiniLM-L12, test        | 79.6%         | 0.8% (3 of 398)      | 98.2%                                          |
| MiniLM-L12, second      | 78.0%         | 1.3% (2 of 156)      | 97.5%                                          |

Round 1 acted alone on 2% under the same rule. Validation here comes from the same generator as
the training data, so a threshold set on it errs on the lax side. Real requests should set it
again (section R8).

## R6. Speed, memory, size

Classifiers, one request at a time over all 500 test requests, tokenizing included, after 10
warm-up requests (`r2/clf/bench_native.py`, `r2/clf/bench_wasm.mjs`; `r2/reports/speed.json`):

| model      | machine                          | engine                                     | median   | p95      | memory                                |
| ---------- | -------------------------------- | ------------------------------------------ | -------- | -------- | ------------------------------------- |
| MiniLM-L6  | envy, Ryzen 7 7700 (WSL)         | onnxruntime 1.32 native, 1 thread          | 1.2 ms   | 1.3 ms   | +55 MB process peak                   |
| MiniLM-L6  | envy                             | onnxruntime 1.32 native, 4 threads         | 0.7 ms   | 0.8 ms   | +55 MB                                |
| MiniLM-L6  | envy (Windows, Node 24)          | onnxruntime-web 1.31 WebAssembly, 1 thread | 3.1 ms   | 4.6 ms   | +175 MB Node memory, library included |
| MiniLM-L12 | envy (WSL)                       | onnxruntime 1.32 native, 1 thread          | 2.5 ms   | 3.0 ms   | +78 MB                                |
| MiniLM-L12 | envy                             | onnxruntime 1.32 native, 4 threads         | 1.4 ms   | 2.0 ms   | +78 MB                                |
| MiniLM-L12 | envy (Windows, Node 24)          | onnxruntime-web 1.31 WebAssembly, 1 thread | 6.7 ms   | 10.0 ms  | +235 MB                               |
| MiniLM-L12 | this laptop, Ryzen 5 4600H, busy | onnxruntime-web WebAssembly, 1 thread      | 21-24 ms | 31-36 ms | +160-230 MB                           |

The WebAssembly runs are each the median of three, and load in 0.25-0.34 s on envy (1 s on the
laptop). MiniLM-L6 in WebAssembly picks the same class as the native int8 run on 99.6% of
requests and scores the same 96.6% exact. MiniLM-L12 agrees on 98.8% and scores 96.0%; its six
differing requests were all close calls, where onnxruntime-web's int8 kernels round
differently. The laptop numbers were taken with a GPU training run and other agents' jobs
running.

Needle round 2, one engine, on envy: native 76 ms median and 99 ms p95 (4 threads, 100 test
requests, 166 MB per engine; a GPU training run was going beside it). Round 1 took 95 ms with
two turns and six engines. In WebAssembly it takes 518-563 ms a request (three runs of 20) with
a 153 MB heap and 6 s to set up; round 1 took 751 ms with six engines and 1.1 GB. One engine
fixes Needle's browser memory problem, but it is still about 170 times slower than MiniLM-L6
there (520 against 3.1 ms) and 28 points less accurate.

## R7. What helped, what didn't

Helped, most first:

1. **A classifier instead of a generator.** The bar's job is to pick one of 82 outcomes and
   read a number. A 23-33M encoder doing exactly that beats a 4-bit generative model that writes
   JSON through a tool prompt by 28 points, at a hundredth of the latency.
2. **Varied data from a big model, and reading its errors.** Fixing the first label bug and
   adding the Hinglish batches (v1 → v2) moved MiniLM-L12 from 94.6% to 96.6% on test and from
   91.0% to 94.5% on the second set. Each label bug showed up as one cluster of confident
   errors. A classifier trained on round 1's templated requests alone was not measured.
3. **One-turn schema for Needle.** Same accuracy as two turns, one engine, faster, and a
   seventh of the browser memory.

Didn't help:

- Renaming tools and enum options, defaults, ranges (Needle untrained: +0.2 points).
- More Needle epochs past 3 (64.6% → 64.4% on validation).
- Ettin-32M: no better in float32, and fragile under int8.
- Bigger pretrained decoders (SmolLM2-135M, Qwen3-0.6B): less accurate after int8, and 6-26
  times larger.

## R8. What production would need

- **Where it runs.** In the browser tab: a 23 MB file (cacheable), onnxruntime-web and a
  tokenizer, about 3 ms a request on a desktop CPU. No server round trip and no GPU. A server
  copy needs only onnxruntime: 1.2 ms on one core.
- **The outcome list is the contract.** Adding an edit means a new class, its requests through
  `gen_plan.py`, and a 15-minute retrain. The executor maps each class to Dazbee commands, as
  round 1's `tools.py` `DAZBEE` table does.
- **Real requests.** The test sets are mine and the training data is GPT's. Real users will
  phrase things neither of us did. Log requests, the chosen button and undo-right-after (a
  wrong auto action). Retrain on them, and set the threshold again on a held-out slice of real
  requests.
- **Delete never auto-runs**, whatever the confidence (round 1's rule stands).
- **Selection context** is still not passed in. "Bigger" on text is resolved by the executor.
- **Export detail:** onnxruntime's quantizer hung on Windows (onnx 1.23's external-data writer)
  for two of the models. `export_eval.py` infers shapes in memory instead. Checked on one model:
  the file it writes gives the same classes and confidences on all 500 test requests.

## R9. Decisions taken without the owner (Claude, 2026-11-22)

- Scored on outcomes (class plus value, defaults filled) rather than raw JSON, so different
  schemas and models compare on what the editor would do.
- Wrote a second frozen test set once the first had guided the data, rather than report only
  the first.
- Among MiniLM-L12 seeds, kept the best on validation (seed 0), although seed 1 scores higher
  on test.
- Recommended MiniLM-L6 over MiniLM-L12 seed 0. They are 0.4 points apart on validation and
  tie on the first test set. L6 is better on the second set and in the browser engine, better
  calibrated, smaller and faster (the answer).
- Stopped Needle at 4 epochs and skipped rank 32 and two-turn Needle training on the same
  data: the classifier settled it.
- int8 per-channel weights for the MiniLMs. Validation, on the v2 MiniLM-L12: float32 97.0%,
  int8 per channel 96.6%, unsigned int8 96.8%, reduced range 95.2%.

Licences (none decided; noted as asked): MiniLM-L6 and MiniLM-L12 Apache-2.0; bge-small MIT;
Ettin MIT; SmolLM2 Apache-2.0; Qwen3-0.6B Apache-2.0; Needle 3 and the Cactus engine
Apache-2.0; onnxruntime and onnxruntime-web MIT; transformers.js Apache-2.0 (each from its
Hugging Face card or package metadata).

Files: `r2/outcomes.py` (outcome codes and scoring), `r2/slots.py` (values), `r2/schemas.py`,
`r2/score_needle.py`, `r2/summarise.py`, `r2/bench_needle.py`, `r2/needle_rows.py`,
`r2/pick_epochs.sh`, `r2/after_needle.sh` (Needle), `r2/gen_plan.py` (data),
`r2/clf/data.py`, `r2/clf/train_clf.py`, `r2/clf/export_eval.py`, `r2/clf/bench_native.py`,
`r2/clf/bench_wasm.mjs`, `r2/clf/score_wasm.py` (classifier); data in `r2/data/`, results in
`r2/reports/`. Model weights are not committed: the recommended one is retrained by
`python r2/clf/train_clf.py --base sentence-transformers/all-MiniLM-L6-v2 --out <dir>` and
`python r2/clf/export_eval.py --run <dir>`.

# Round 1 (2026-11-21): Needle 3

## Answer

**Needle 3 tuned with LoRA understands about three in four requests it has never seen phrased
that way (75.8% exact on the held-out test set, from 35.5% untrained), but it can't yet tell
its right answers from its wrong ones well enough to act on its own.** Under the rule "act alone
only where wrong actions stay at 1-2% or below", the bar acts on its own for 2% of requests
(0 wrong of 10 on test) and offers its best two guesses as buttons for the rest; the right
action is among those two for 80% of them. Every depth below 20 layers is less accurate, so
the archive keeps all 20.

Recommendation: don't ship it as an auto-acting bar yet. It's worth one more round, aimed at
the data rather than the model: collect real requests from the people who use the editor
(typed into a suggestion-only bar that shows the two buttons), add them to training, and
measure again. The mistakes it makes are systematic (a phrasing it misreads, it misreads every
time, in both tuned models), which only more varied phrasings fix; the confidence head can't
catch them, and full fine-tuning did no better than LoRA (section 8).

|                                                       | untrained Needle (4-bit, 20 layers) | LoRA rank 16 (20 layers)  | LoRA + our confidence head       |
| ----------------------------------------------------- | ----------------------------------- | ------------------------- | -------------------------------- |
| exact call, all 504 test requests                     | 35.5%                               | **75.8%**                 | 75.8% (the head changes no call) |
| actions exactly right (440)                           | 27.3%                               | 76.4%                     | 76.4%                            |
| off-topic, vague and two-action requests refused (64) | 92.2%                               | 71.9%                     | 71.9%                            |
| router picks the right area                           | 53.9%                               | 89.8%                     | 89.8%                            |
| confidence AUROC (right vs wrong call)                | 0.64                                | none (engine reports 1.0) | 0.82 test, 0.66 validation       |
| acts on its own at the chosen threshold               | –                                   | –                         | 2.0% of requests, 0 wrong        |
| right action in the two buttons when it doesn't act   | –                                   | –                         | 80.0%                            |

Speed of the chosen archive (63.5 MB, 4-bit), both turns of a request: 95 ms on the native
engine on envy's CPU (471 ms on this laptop with other jobs running); 751 ms in Node through
Cactus's WebAssembly engine with one engine per toolset, at 1.1 GB of WebAssembly memory
(1.3 s on this laptop). Details in section 9.

## 1. The actions and the two turns

A request goes through Needle twice. Needle's tool guide: five tools or fewer render directly;
above five the engine retrieves five and the rest can't be called. So:

1. **Router turn**: five area tools, no arguments: `text_style`, `size_and_shape`,
   `colour_and_brand`, `arrange`, `layers`. No call: not something this bar does.
2. **Action turn**: only the picked area's four or five tools. No call: nothing to do.

24 tools; with their enums and numbers they cover 70+ distinct editor outcomes. Each acts on the
current selection and becomes Dazbee's own commands, one undo step, as the edit panel or a
shortcut does it today (schemas in `tools.py` and `data/tools.json`):

| area             | tool (arguments)                                                       | runs in Dazbee                                                                                                  |
| ---------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| text_style       | `set_text_weight(weight: thin…black)`                                  | `node.style {text: {fontWeight 100..900}}`                                                                      |
| text_style       | `set_text_case(case: uppercase, lowercase, title case, normal)`        | `node.style {text: {textCase}}`                                                                                 |
| text_style       | `style_text(style: italic, underline, strikethrough; on)`              | `node.style {text: {fontStyle / underline / strikethrough}}`                                                    |
| text_style       | `align_text(align: left, center, right, justify)`                      | `node.update {patch: {align}}`                                                                                  |
| text_style       | `change_spacing(spacing: letter, line; direction: more, less)`         | `node.style {text: {letterSpacing / lineHeight}}` by a fixed step                                               |
| size_and_shape   | `resize(direction: bigger, smaller; percent?)`                         | `node.update`: text `style.fontSize` (and runs), else width and height about the centre; 20% when none is named |
| size_and_shape   | `set_font_size(size)`                                                  | `node.update {patch: {style: {…, fontSize}}}`                                                                   |
| size_and_shape   | `rotate(degrees: -360..360)`                                           | `node.update {patch: {rotation: current + degrees}}`                                                            |
| size_and_shape   | `flip(axis)`                                                           | editor `flipHorizontal` / `flipVertical` (`node.flip`)                                                          |
| size_and_shape   | `round_corners(radius, default 16)`                                    | `node.style {corners}`                                                                                          |
| colour_and_brand | `use_brand_colour(role: primary…text)`                                 | `node.bind {property: textColor for text else fill, ref: brand:<role>}`                                         |
| colour_and_brand | `set_colour(colour: 14 names)`                                         | `node.style {fills: [solid]}` or `{text: {color}}`                                                              |
| colour_and_brand | `set_hex_colour(hex)`                                                  | as `set_colour`                                                                                                 |
| colour_and_brand | `set_opacity(percent; measure: opacity, transparency)`                 | `node.style {opacity}`                                                                                          |
| colour_and_brand | `use_brand_font(font: heading, body)`                                  | `node.bind {property: fontFamily, ref: brand:heading / brand:body}`                                             |
| arrange          | `align_layers(edge: left…bottom)`                                      | editor `alignLeft` … `alignBottom` (one layer aligns to its frame)                                              |
| arrange          | `distribute_layers(direction)`                                         | editor `distributeHorizontal` / `distributeVertical`                                                            |
| arrange          | `change_layer_order(to: forward, backward, front, back)`               | `node.reorder`                                                                                                  |
| arrange          | `move_layers(direction; pixels, default 10)`                           | the arrow-key nudge                                                                                             |
| layers           | `duplicate_layers()` / `delete_layers()`                               | editor `duplicate` / `delete`                                                                                   |
| layers           | `group_layers(action)` / `lock_layers(action)` / `hide_layers(action)` | editor `group`/`ungroup`, `node.lock` every flag, editor `hide`                                                 |

Not in this bar (no call): shadows, outlines, crop, background removal, text content edits,
new layers, export, undo, anything generative ("make me an ad for …"), and two actions in one
request ("bold and red").

## 2. Data

Written by hand, with no model and no outside service: 713 request templates for the 66 call
shapes and 179 refusal templates, filled with slot values (the thing selected, sizes, degrees,
colours, brand roles, hex codes, directions) and varied by politeness wrappers, US/UK spelling,
case and a 7% typo rate (`gen_data.py`, deterministic). Each template belongs to one split only,
so validation and test hold phrasings training never saw; some objects, wrappers and colour
words exist only in test.

| split                        | requests | actions | refusals (big / unrelated / unsupported / vague / negated / two actions) | templates |
| ---------------------------- | -------- | ------- | ------------------------------------------------------------------------ | --------- |
| train                        | 3,030    | 2,650   | 90 / 73 / 96 / 62 / 32 / 27                                              | 467       |
| calib (confidence head only) | 800      | 700     | 23 / 15 / 25 / 20 / 9 / 8                                                | 131       |
| validation                   | 504      | 440     | 18 / 11 / 14 / 8 / 7 / 6                                                 | 127       |
| test                         | 504      | 440     | 14 / 15 / 20 / 6 / 6 / 3                                                 | 128       |

The Needle training rows (`*.needle.jsonl`, regenerated by `gen_data.py`) hold both turns per
request, plus 35% of requests again with a wrong area's tools and no call, so a misroute ends
in nothing: 6,770 train rows, 1,140 validation rows. Each target opens with a short reasoning
line (`set_text_case: case "uppercase".`): the engine always starts the answer with a think
block, and a first LoRA trained without one still wrote free reasoning in the engine (33% exact
on 60 validation requests against 51% by teacher forcing).

A caveat on the sets: each split's requests come from about 130 templates, about four requests
each, so a misread phrasing counts several times. That makes the scores coarse (a template is
worth about 0.8%) and validation and test differ more than their size suggests.

Forgetting check (`forget_set.py`; rebuilt from its sources, not committed): 100 requests each
from google/mobile-actions (CC-BY-4.0), NousResearch/hermes-function-calling-v1 (Apache-2.0) and
nvidia/When2Call (CC-BY-4.0, requests with no call), five tools at most.

## 3. Scoring

`score.py` runs every request through the real Cactus engine (cactus-compute 4.2.6, native
Linux build, `CACTUS_TELEMETRY=0`) with an exported `.cact`, both turns; `--every-area` also
runs turn two with each other area's tools, for the head's examples and the fallback buttons.
`metrics.py`: exact call (same tool and arguments; no call when none is wanted), refusals,
router accuracy, AUROC and ECE of the confidence, the risk-coverage curve, and at a threshold
the share of requests acted on and the wrong share of those actions. `confidence_report.py`
picks the threshold on validation and reports it on test; `metrics.fallback` measures the
two-button fallback (turn two in every area, best two calls by confidence).

**The engine's repair step undoes right answers.** After decoding, the engine rewrites
arguments from the request's words: "release the shape from its group" names "group", so the
model's `ungroup` becomes `group`; "turn off bold" stays `bold`; "square off the corners" names
no number, so radius 0 becomes the default 16. It also withholds some right calls into
`suppressed_calls`. The tuned model states its call in its reasoning line, so the prototype
reads the call from there (`model_call.py`, checked against the tool's schema) and falls back
to the engine's call when the line can't be read. On test that is 75.8% exact against 64.5%
with the engine's call (`reports/tables-test-model.md`, `reports/tables-test-engine.md`). A
production build would want an engine switch for the repair step instead.

## 4. Base Needle, untrained

Test, engine calls, every depth in `reports/tables-test-engine.md` ("base"): the base checkpoint
exported at 4 bits, 20 layers: 35.5% exact, 27.3% of actions, 92.2% of refusals, router 53.9%,
AUROC 0.64. The published 2-bit `needle3.cact`: 31.7% exact. Every depth below 18 is worse.

## 5. LoRA

`train_lora.py`: Cactus's own recipe (LoRA on q/k/v/gate/out of all 20 layers, float32, the 4-bit
CQ weights simulated in the loss), lr 1e-4, alpha = 2 x rank, our validation file, the epoch with
the best validation exact share by teacher forcing kept, patience 4, resumable per epoch.

| run     | epochs                                                                                                                                                                    | best epoch | teacher-forced validation exact | engine, validation, exact | engine, test, exact                |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------- | ------------------------- | ---------------------------------- |
| rank 16 | 1-2 at batch 8 (a power cut stopped epoch 3 at step 400); then 3-12 warm-started from the epoch-2 adapter, batch 16, fresh optimiser, a new cosine schedule over those 10 | 10         | 0.864                           | **0.784**                 | **0.758**                          |
| rank 32 | 1-12, batch 16, one run                                                                                                                                                   | 11         | 0.860                           | 0.774                     | not run (validation chose rank 16) |

Every depth of rank 16 on test (model calls; `reports/tables-test-model.md`): L20 75.8%, L19
68.3%, L18 65.3%, L17 32.1%, L16 25.4%, and 10-32% below. No smaller depth is as accurate, so
the chosen archive keeps 20 layers. (The adapter was trained at 20 layers and sliced; training
each depth would close some of the gap but not to L20's level on this evidence.)

Where rank 16 still goes wrong on validation (model calls, 109 of 504): the router picks
another area (38, such as "smaller line height" taken as a size change), a wrong option of the
right tool (39, such as "turn off bold" read as bold), no call (11), another tool (8, such as
"keep it from being edited" read as delete), and 13 refusals it acted on (two-action, negated
and vague requests).

Forgetting set: published base 45.7%, 4-bit base 37.7%, LoRA rank 16 32.7%.

## 6. Our confidence head

Cactus has no open path for training the head, and `cactus build --lora` drops the base one.

What the engine reads (`head_check.py`, base archive at 4 bits): the JAX head equals the
engine's score within 0.01 on 53% of 30 calls and is clearly below it on only 7% (the engine
reports min(head, decode probability)), correlation 0.97, when it reads the training render
with compact tools JSON, then the model's think line, then the tool call. Prompt only gives
correlation 0.14; spaced tools JSON 0.78.

`train_head.py` trains only the head (71k values, from the base head's values) on that
sequence, with the tuned backbone frozen under the export's numerics (CQ4, A8), binary
cross-entropy, then Platt scaling folded into its last projection; `export_cact.py --head`
writes it into the archive. Our head inside the engine (`head_verify.py`, 81 calls): the JAX
score and the engine's agree with correlation 0.997, equal within 0.01 on 67%.

Two heads were trained (labels: the tuned model's own calls through the engine, 1 when exactly
right for that turn):

| head       | trained on                                                                   | turn-level validation AUROC | end-to-end AUROC, validation / test |
| ---------- | ---------------------------------------------------------------------------- | --------------------------- | ----------------------------------- |
| 1          | calib and 1,200 train requests (every area), plus gold calls and near misses | 0.79 (epoch 1, by loss)     | 0.63 / 0.79                         |
| 2 (chosen) | calib requests only (every area), epoch by AUROC                             | 0.79 (epoch 4)              | 0.66 / 0.82                         |

Without a head the engine's confidence is the decode probability alone: 1.0 for almost every
call, AUROC 0.50.

**Why it can't do better here:** the wrong calls are systematic. Agreement between the rank 16
and rank 32 models (`agreement.py`, validation) still leaves 15.7% of the calls they agree on
wrong, and adding "no other area also claims it" leaves 14.9%: both models misread the same
phrasings, and nothing inside them marks the misreading.

## 7. Auto-decide: the trade-off and the threshold

Rule: act alone at the threshold that acts on the most validation requests while wrong actions
stay at or under 1% (then 2%) of those it acts on; otherwise show the best two guesses, or
nothing for a refusal. Chosen: **head 2, the action turn's confidence, threshold 0.90**
(validation: 14 of 504 acted on, 0 wrong; the same threshold for 1% and 2%).

On test at 0.90: 10 of 504 requests acted on (2.0%), 0 wrong. Of the 430 on-topic requests it
doesn't act on, the right call is the first button for 75.3% and among the two buttons for
80.0%. Joining both turns' confidence (minimum or product) acted on fewer.

The trade-off on test (head 2, action turn's confidence; `reports/confidence-r16-head2.json`):

| threshold     | acts on (share of all requests) | wrong share of those actions |
| ------------- | ------------------------------- | ---------------------------- |
| 0.30          | 75.4%                           | 13.9%                        |
| 0.50          | 59.1%                           | 7.4%                         |
| 0.60          | 51.0%                           | 6.2%                         |
| 0.70          | 37.5%                           | 5.8%                         |
| 0.80          | 19.0%                           | 3.1%                         |
| 0.85          | 8.3%                            | 0.0%                         |
| 0.90 (chosen) | 2.0%                            | 0.0%                         |

On validation the curve is worse (0.80: 18.3% acted, 8.7% wrong; 0.85: 7.7%, 15.4% wrong),
which is why the rule lands at 0.90. Test alone would allow 0.85 (8.3%, none wrong); with sets
this size and this clustered, the threshold is only as good as the validation set.

## 8. Full fine-tuning with replay

`train_full.py`: every weight but the probe heads trains (lr 2e-5, batch 16, 4-bit weights
simulated in the loss); every fourth step is a replay batch of 800 public requests from
mobile-actions and hermes-function-calling (none of the rows the forgetting check scores), on
which the model is held to the untrained model's next-token distribution by a KL term (weight
1.0). Six epochs, 58 minutes.

|                            | teacher-forced validation exact | engine, validation, exact | engine, test, exact | forgetting set         |
| -------------------------- | ------------------------------- | ------------------------- | ------------------- | ---------------------- |
| LoRA rank 16               | 0.864                           | 0.784                     | **0.758**           | 0.327                  |
| full fine-tune with replay | 0.771 (epochs 4-6)              | 0.645                     | 0.667               | **0.380** (base 0.377) |

Replay did its job (the forgetting score stays at the untrained model's), but the command bar
is 9 points worse on test, so LoRA stays. A higher learning rate might close part of the gap;
I didn't run it, as the evidence above says the limit is the data, not the method.

## 9. Speed, memory and size

The archive is 63.5 MB (4-bit weights, the head and the tokenizer); the published 2-bit base
is 35 MB. Each engine holds about 173-177 MB at its peak (engine report). Timings are both turns of
one request, each run on 60 test requests (native) or 20 (WebAssembly), three runs, median and
range; nothing else of this prototype was running.

| machine                                                         | engine                                         | request time, median of 3 runs (range) | p95, median |
| --------------------------------------------------------------- | ---------------------------------------------- | -------------------------------------- | ----------- |
| envy, Ryzen 7 7700 (WSL), idle                                  | native, 4 threads                              | **95 ms** (93-96)                      | 126 ms      |
| envy                                                            | WebAssembly in Node 18, one engine per toolset | 751 ms (750-752)                       | 1,047 ms    |
| this laptop, Ryzen 5 4600H, other agents' jobs using 10-40% CPU | native, 4 threads                              | 471 ms (457-475)                       | 640 ms      |
| this laptop                                                     | WebAssembly in Node 24, one engine per toolset | 1,335 ms (1,210-1,494)                 | 1,955 ms    |

(`reports/speed-envy-native.json`, `reports/speed-legion-native.json`, `reports/speed-wasm.json`.)
The times in the scoring tables (about 420 ms) were taken with four scoring processes sharing
the CPU, so they compare models, not a person's wait.

The WebAssembly engine sets a toolset up with `cactus_init`, which reads the whole tool prompt:
2.2 s a turn on envy, 4.3 s on the laptop. Switching tools per turn on one engine costs 4.4 s a
request on envy and 8.8 s on the laptop (one run of 4 requests each); one engine per toolset
(six, set up once in 16 s on envy, 25-29 s on the laptop) brings it to 0.75 s and 1.3 s, at
1.1 GB of WebAssembly memory, too much for a quick bar in a browser tab.

Training time on envy (RTX 4070 Super 12 GB, alone on the GPU): about 6.5 minutes an epoch for
LoRA at batch 16 (rank 16's ten epochs after the restart: 65 minutes; rank 32's twelve: 78), the
first compile under a minute. With another training job sharing the GPU and the CPU, the same
step compiled for 40 minutes and ran at a third of the speed. The head: 6 minutes. Engine runs
for the head's examples: about 15 minutes on the CPU.

## 10. What production would need

- **Where it runs.** On our API servers, natively: about 0.1 s a request on four desktop cores,
  a 64 MB archive, about 175 MB per engine, six engines (router and five areas) per worker. Not
  in the browser: 0.75-1.3 s and 1.1 GB with six WebAssembly engines, or 4-9 s with one.
- **The engine's repair step** needs a switch, or the call read from the reasoning line as
  here (`model_call.py`). Cactus's engine is a prebuilt binary under Apache-2.0; asking them,
  or patching a build, are the two ways.
- **Retraining.** A script run, on envy or any 12 GB GPU: `gen_data.py` (plus real requests),
  `pipeline.sh` (LoRA, head, scores, threshold) in about two hours; the threshold set again on a
  fresh validation set each time. Real requests the bar showed buttons for, with the button the
  person pressed, are exactly the labelled data both the model and the head lack.
- **Selection context.** The bar acts on the selection; the model never sees it. Requests that
  only make sense for some layer types ("bigger" on a text is its font size) are resolved by the
  executor; passing the selection's types as a system fact is the next thing to try.

## 11. Risks

- Wrong actions on unseen phrasings are confident: at any threshold that acts on a useful share
  of requests, 3-7% of actions are wrong, and some are destructive ("keep it from being edited"
  read as delete). Delete should never auto-run from the bar.
- The scores rest on phrasings I wrote; real users will write others, and accuracy on those is
  unknown until measured.
- The engine's repair step and grounding gates change between Cactus releases; the scores are
  for cactus-compute 4.2.6.
- The training machine lost power twice during this run; training now saves its adapter and
  optimiser every epoch, so a cut costs at most one epoch.

## 12. How it ran, and what was decided along the way

Decisions taken without the owner (2026-11-21), each in the code or above:

- 24 tools in five areas, enums carrying the variants, instead of 30 separate tools, to keep
  every turn at five tools or fewer.
- The selection is not passed to the model; the executor reads "bigger" as font size on text.
- No outside model for data, per the coordinator's change: every request is hand-written
  templates and slot values.
- Four splits by template, the calib split kept out of LoRA for the head's examples.
- A reasoning line in every target (the engine forces a think block), and the call read from it.
- LoRA rank 16 chosen over 32 on validation; 20 layers; the warm start after the power cut.
- GPU memory capped while another job shared the card (batch 8, 0.45-0.5 of memory), back to
  full speed when the card was free.
- Head 2 and the action turn's confidence, threshold 0.90.

envy went offline twice (power cuts at about 02:45 and 08:36 UTC). The first cost a restart
before training had saved anything; the second stopped rank 16 in epoch 3, and training resumed
from the epoch-2 adapter (section 5). No step after the cuts used a half-written result: each
engine run writes its file only when complete, and every run after the second cut started from
saved files.

Files: `tools.py` (tools), `gen_data.py` (data), `score.py` and `metrics.py` (engine scoring),
`model_call.py` (the call before repair), `train_lora.py`, `train_head.py`, `train_full.py`,
`export_cact.py`, `head_check.py` and `head_verify.py` (the head against the engine),
`confidence_report.py`, `agreement.py`, `bench_native.py`, `bench_wasm.cjs`, `bench_repeat.py`,
`pipeline.sh`, `after_lora.sh`, `after_head.sh`; results in `reports/`.
