# Quick command bar on Needle 3: prototype report

PROTOTYPE, never merged; branch `command-bar-prototype`. Every number below was measured on
the files in this folder (the raw engine results stay on the training machine); where each
comes from is named next to it. Written 2026-11-21.

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
