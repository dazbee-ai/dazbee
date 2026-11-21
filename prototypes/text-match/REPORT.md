# Text matcher prototype: report

This is a prototype and is never merged. It answers one question: what is the most accurate way to turn a text block from a flat ad picture into an editable Dazbee text layer on a one-CPU server, and how close can a lean Light version get to Medium?

The prototype skill offers two kinds of prototype: a logic walkthrough or a UI. This question is neither, so the prototype is a measuring harness run from the command line, plus this report.

## Headline

**Synthetic held-out test set** (240 blocks with exact ground truth, never looked at while building):

| | Looks the same (shared rule) | Looks the same (rule v2) | Same family | Exact face | Time per block, one core, median (p95) |
|---|---|---|---|---|---|
| Light, whole library | 20.4% | 31.7% | 63.3% | 51.2% | 0.33 s (2.3 s) |
| **Medium, whole library** | **28.3%** | **43.3%** | **67.9%** | **52.9%** | **1.7 s (12 s)** |
| Light, Dazbee's 321 families | 12.9% | 20.4% | 45.0% (71.2% when the true font is in the 321) | 32.1% | 0.31 s (4.0 s) |
| Medium, Dazbee's 321 families | 18.8% | 28.3% | 46.3% (72.9% when the true font is in the 321) | 31.7% | 1.6 s (16 s) |

**DeltaX test ads** (221 text blocks in 48 ads; 16 held-out ads with 69 blocks are reported separately below):

| | Looks the same (shared / v2) | Median SSIM / ΔE | Per ad, median |
|---|---|---|---|
| Light, library | 0% / 0% | 0.63 / 22.2 | 2.6 s on 1 core |
| Medium, library | 0% / 0.9% | 0.74 / 17.6 | 12.4 s on 1 core |
| Old worker | 0% / 0.8% (1 of 130) | 0.72 / 18.1 on its 130 blocks; ours on the same 130: 0.76 / 15.0 | 92 s on 4 cores; failed 16 of 48 ads at its 150 s limit; on 1 core, 10 of 11 ads failed |

- **Peak memory:** ours 0.6 GB (321 families) or 1.3 GB (whole library), against 5.1 GB for the old worker on 4 cores.
- **Size:** model 17.2 MB plus 4.2 MB of fingerprints for 8,143 faces.
- **Training:** 43 min on the RTX 4070 Super, after 2 × 4.6 min of drawing samples on envy.

## Recommendation

1. **Use Medium**, with the fingerprint model trained on the whole Google Fonts library at 96 samples a face (width 48), and the fingerprint's vote added to the ranking.
   - It is the most accurate on every measure that matters.
   - It runs on one core: about 1.6–1.7 s per block and 12–17 s per ad (median).
   - Light is about 5× faster but cannot equal Medium. It trails by 8 points on looks-the-same (library) and by 6 points on Dazbee's 321. The gap comes from Medium's tuning step and its larger shortlist (the right family is in the shortlist 88% of the time, against 79% for Light).
2. **Train on the whole library**, even while Dazbee offers only its 321 families. At the same samples per face, the library-trained model is 9 points better on the 321 families (face top-1 78.4% against 69.5%).
   - Import the whole library into the catalogue: on synthetic text set in faces Dazbee doesn't offer today, matching against the 321 gets the family 20.5% of the time, against 68.0% against the library.
3. **Don't ship the keep-as-picture decision on the shared rule, or on v2, as they stand.**
   - Both keep 100% of the real ads' text as pictures, the old worker's included.
   - On 20 pairs judged by eye, either rule agrees with the eye 7 times out of 20.
   - Calibrate a rule from blind judgements by the owner (100 or more pairs) before production. Every result stores its layer, so all numbers can be scored again under a new rule.
4. **Before production, cap the work on very large blocks.** One 378-px-tall hollow-letter block takes 200–470 s in Medium, because every draw is block size plus padding. Rank and tune at a capped working scale, then check once at full size.
5. **The old worker is beaten.** On its own 130 blocks, Medium's result is closer: SSIM 0.76 against 0.72, ΔE 15.0 against 18.1, and higher SSIM on 82 of 130 blocks. It runs on one core where the old worker cannot, in about a quarter of the memory.

## Decisions (Claude, 2026-11-21)

**Data and fonts**
- The prototype is a command-line measuring harness, as the prototype skill's two kinds (logic walkthrough, UI) don't fit this question.
- **Catalogue:** fetched the way `fonts:google` copies it (Google's CSS API, SVG table taken out): 1,760 faces, which is production's 1,753 plus 7 shipped.
- **Whole library** (owner's decision): a fresh clone of github.com/google/fonts at commit `06bfe0d6`. It has 2,042 families and 8,315 faces, from ofl, apache and ufl only. A variable file counts as one face per hundred of weight its weight axis reaches.
  - The 321-family subset is marked as exactly the 1,760 faces Dazbee offers.
  - Colour fonts (96 faces in 23 families) are left out, as Dazbee's catalogue leaves them out.
  - The copy in the old worker's folder was not used.
- Font files are read directly; no database is used.
- Only blocks of kind `text` are matched; `logo` blocks are not.
- Of the reading, only the text is used, not its style hints.
- **Pixels:** matching works in the block's own (bucket) pixels. The ad is a uniform ×source/bucket away (1.2308 for 19 ads).
- **Tilt:** DeltaX blocks use the cutting step's angle. Synthetic blocks get no angle, which tests the estimator.

**Model**
- Training is in PyTorch (offline, GPU). Running is ONNX through onnxruntime-node: no Python at run time, and 3–30 ms per window on one thread.
- Each face is known by the mean fingerprint of its samples (nearest class mean), so faces can be added without training again.

**Scoring and judging**
- The shared rule is implemented exactly. For flat crops, the foreground is the ink rather than the alpha.
- Kept beside it as diagnostics, never used for decisions: blur-matched score, ink missed/extra, the white-and-black variant, and rule v2.
- The 20-pair threshold check was judged by eye after seeing the scores, so it is not blind.
- The old worker's answers are drawn with Dazbee's renderer, with units converted, and placed by ink centre exactly as ours are.

**Held-out sets**
- Synthetic: the first third of the 360 blocks is the development part, the rest the test part.
- DeltaX: every third ad by name is held out (16 ads). Their pictures and per-block results were never opened.
- Examples and judged pairs come from development ads only.
- The test part was scored three times in round 2: the bigger model, then the fingerprint vote, then a fix to the brand margin's units, which the vote had changed. The settings themselves were chosen on the development part.

## What the research says, and what was used

- **DeepFont** (https://arxiv.org/abs/1507.03196): synthetic training with degradations, patches averaged at test time; 71.4% / 81.8% top-1 / top-5 on real images. Used: the training recipe.
- **Chen et al., CVPR 2014** (https://openaccess.thecvf.com/content_cvpr_2014/html/Chen_Large-Scale_Visual_Font_2014_CVPR_paper.html): nearest class mean on a learned metric, so fonts can be added without retraining. Used: how faces are known.
- **Chen et al., ICCV 2019** (https://arxiv.org/abs/1909.02072): features that ignore the words. Used: random strings per sample, and fingerprints averaged over windows of different words.
- **Shimoda et al., ICCV 2021** (https://arxiv.org/abs/2110.01890): predict the parameters, then refine by rendering and comparing. Used: the whole Light/Medium design.
- **LayerD** (https://arxiv.org/abs/2509.25134): layer decomposition; the DeltaX blocks are such cut-outs.
- **Tesseract** (https://research.google/pubs/an-overview-of-the-tesseract-ocr-engine/): baseline and line fitting. Used: line bands measured from the ink.
- **Leptonica / Postl's skew method** (https://tpgit.github.io/UnOfficialLeptDocs/leptonica/skew-measurement.html). Used: tilt estimation.
- **SSIM** (https://ece.uwaterloo.ca/~z70wang/research/ssim/) and **CIEDE2000** (https://www.ece.rochester.edu/~gsharma/ciede2000/): the shared rule's measures. The CIEDE2000 here matches six of Sharma's test pairs (`src/score-check.ts`).
- **Products:** Adobe Match Font publishes no figures. Canva Grab Text is Latin only, with no bold or italic.
- **VLMs read the words, not the shapes** (COLM 2025, https://arxiv.org/abs/2503.23768), which is why the model is a dedicated one.

**2026 methods**
- **Lens (mixfont)**, https://github.com/mixfont/lens: ResNet-18 over 983 families, 224-px grayscale crop of the largest word. Its terms are personal, academic and non-commercial only; it has no LICENSE file and publishes no accuracy. Not used; its preprocessing is noted only as an idea.
- **Graphic-Design-Bench** (arXiv 2604.04192): 2,556 text elements, data CC BY 4.0 and code Apache-2.0. The best reported scores (GPT-5.4) are family top-1 0.237, size MAE 8.97 px, colour ΔE 5.57. Usable as an outside benchmark, not yet run (it needs an adapter for crops and labels).
- **CreatiParser** (arXiv 2604.19632): a vision-language model writes the parameters, then is refined with a render-and-compare reward; font accuracy 0.873 on its own unreleased data. Idea only: it confirms render-and-compare refinement.
- **Reading ≠ Seeing** (arXiv 2603.08497): VLMs are near chance on font style, and scale doesn't help. This supports a dedicated model.
- **SynLayers** (arXiv 2605.15167; its base data isn't commercially safe) and **LaDe** (CVPRW 2026; private data): text is handled only as an RGBA layer. Nothing usable.

## Design

`src/match.ts`; Light and Medium are one pipeline with different budgets.

1. **Measure** (`src/measure.ts`): ink (a cut-out's alpha, or a flat crop's distance from its border colour); tilt (the given angle, or Postl's method within ±15°); lines split to the reading's line count; alignment; fill (the median of the inner ink); outline (an edge ring differing by ΔE > 12); background (from the ad behind the block).
2. **Prune:** faces that draw the script and every letter of the text; no colour fonts; in 321-family mode, only the faces Dazbee offers.
3. **Brand first:** the kit's fonts are always tried, and a brand font wins if its shape score trails the best by ≤ 0.03. A colour within ΔE 8 of a kit colour takes that colour and binds `textColor`; the chosen font binds `fontFamily` (`BINDABLE_PROPERTIES`). A matching brand text style is applied when it draws as well.
4. **Fingerprint** (`src/fingerprint.ts`): each line becomes a 32-px strip, read in 128-px windows; the ONNX model gives one fingerprint per window, averaged. Cosine nearest class mean gives a shortlist: Light 5, Medium 25.
5. **Fit each candidate:** size from line heights; letter spacing from the missing width over the number of places spacing goes, measured by laying the line out with and without spacing, so clusters and ligatures count right; line height from line pitch; placed by ink centre.
6. **Rank** by letter shape: tiles half the font size wide, each free to move up to 8% of the size, scored by intersection over union, plus 0.5 × the fingerprint's similarity (weight chosen on the development part).
7. **Correct:** a Newton step from the placed draw (Light: best 2 once; Medium: best 3 twice, plus the other weights of the best 3 families).
8. **Tune** (Medium only): size, spacing, line height, x, y and outline width by coordinate descent on the overlap.
9. **Verify:** finalists (Light 2, Medium 5) are drawn in full colour with Dazbee's renderer and scored by the shared rule. The first that looks the same wins, else the closest; the block is kept as a picture when the winner doesn't look the same.
10. **Guards:** a candidate whose fitted size is outside ¼–4× the line height is dropped.

**Model** (`train/train.py`, one command, CUDA when there is a card): a residual CNN with widths c, 2c, 4c, 4c, 6c, 6c; mean over the width so vertical structure stays; a 128-number fingerprint. CosFace loss (s 30, m 0.25), AdamW, one-cycle schedule, 12 epochs, half precision on CUDA. Augmentation on the GPU: height jitter, slant, lost resolution, blur, faded ink, noise.

## What Dazbee does better than a stand-alone worker

- Candidates are drawn by Dazbee's own renderer on the CPU surface, the pixels an export makes. There is no conversion from Fabric or Chrome units.
- It uses Dazbee's own units and shaping: letter spacing in %, line height, outline centred over the fill, and spacing gaps counted by HarfBuzz through SkParagraph.
- Brand first: results come back bound to the kit (`brand:heading`, `brand:primary`). Synthetic library test, Medium: kit holds the true font and it is bound correctly 83.8%; kit lacks the font and it is wrongly bound 13.3%; colour bound to `brand:primary` 84.6%.
- A brand's uploaded font gets a fingerprint at upload with no training run, and the same goes for importing the whole library.
- The known words drive everything: the same text is drawn for every candidate, faces missing a letter are dropped, and the script selects the faces.
- No Chrome and no Python at run time: one Node process on one core.

## Results

### Synthetic test, round 2 (whole library, Medium)

| Parameter | Error |
|---|---|
| Size | 1.5% |
| Letter spacing | 0.9 % points |
| Line height | 0.03 |
| Colour | ΔE 0.3 |
| Tilt | 0.0° |
| Outline found right | 88% |

Looks the same (shared rule), by group (library, round 1, Medium): degradation none 53.7%, mild 28.9%, strong 3.9%; Latin 24.8%, Arabic 37.5%, Devanagari 30.2%; sans-serif 31.0%, serif 21.7%, display 18.2%, handwriting 33.3%; brand with the font in the kit 27%, no brand 28%. The strict rule fails nearly every strongly degraded block, even when the face is exactly right.

Same family by category (Light / Medium): sans-serif 64% / 66%, serif 54% / 59%, display 77% / 73%, handwriting 71% / 71%.

Round 1 against round 2 (whole library, Medium), looks the same shared / v2 and exact face: round 1 27.9% / 41.7%, 47.1%; bigger model alone 27.9% / 42.5%, 48.3%; bigger model + fingerprint vote + 5 finalists 28.3% / 43.3%, 52.9%. On Dazbee's 321, with the true font in the 321: family 66.9% → 72.9%, exact face 44.9% → 52.5%.

### DeltaX test ads

| | Median SSIM / ΔE, all blocks | Median SSIM / ΔE, held-out ads | Looks the same (shared rule) |
|---|---|---|---|
| Medium, library | 0.74 / 17.6 | 0.73 / 19.5 | 0% |
| Light, library | 0.63 / 22.2 | 0.61 / 25.1 | 0% |

Same family as the old worker: 4–11% (it picks from 7,036 faces, and near-identical families abound). Library against 321 families on real ads: about equal (Medium SSIM 0.74 against 0.73).

### Threshold check by eye (20 development pairs, Medium)

The eye says "looks the same" on 13 of 20. The shared rule, rule v2, the white-and-black variant and the blur-matched score each say 0 of 20 and agree with the eye 7 times. The pairs the eye passed have SSIM 0.67–0.94 and ΔE 4.9–22. AI lettering is never an exact real font, so pixel thresholds reject results that read as the same.

### Fingerprint scaling (held-out strips, face top-1)

| Model (samples a face, width) | Faces | Top-1 | Top-5 | Top-1 on the 321 | Training time |
|---|---|---|---|---|---|
| Catalogue, 6 / 12 / 24 / 48, w32 | 1,759 | 15.8 / 32.1 / 49.3 / 69.5 | 38.9 / 62.1 / 78.3 / 90.8 | same | 1–3 min |
| Catalogue, 48, w16 / w48 | 1,759 | 59.3 / 73.4 | | | 2 / 5 min |
| Library, 12 / 24 / 48, w32 | 8,143 | 36.9 / 51.7 / 61.3 | 64.9 / 77.8 / 84.1 | 51.2 / 67.7 / 78.4 | 6 / 12 / 14 min |
| Library, 48, w16 | 8,143 | 51.4 | 78.0 | 68.4 | 22 min |
| **Library, 96, w48 (bigger run)** | 8,143 | **70.8** | **88.9** | **87.2** | 43 min |
| Hand-written features (47 numbers) | 1,759 | 5.3 | 12.0 | — | — |

- Data matters most: each doubling of samples a face added 10–20 points of top-1.
- But it no longer moves the end result: the bigger run's +9.5 points of top-1 moved Medium's looks-the-same by only +0.4 points. The bottleneck is now choosing within the shortlist and the rule itself.
- Model sizes: w16 2.0 MB, w32 7.7 MB, w48 17.2 MB. Speed per window, one thread: 3 / 12 / 29 ms.
- int8: dynamic quantisation makes the model 4.3 MB with the same accuracy (top-1 71.0% against 70.7%), but ORT's dynamic convolutions are about 20× slower. Use static QDQ int8 or fp16 instead.
- GPU: the laptop's GTX 1650 managed about 125 s an epoch on 84k samples; the 4070 Super is about 10× faster. A 192-samples-a-face, w48 run is about 1.5 h alone on the 4070 Super; by the curve it would bring about +4–6 points of top-1 and probably under 1 point of looks-the-same. Cloud GPUs aren't needed.

### Round 2 status

| Item | Status |
|---|---|
| ImageNet ResNet-18 (torchvision, BSD-3 code; ImageNet's own terms are a grey area) + stronger augmentation | Reached at least epoch 8 of 12; envy went offline before its final metrics; no per-epoch checkpoints, so it must be rerun (it may have finished into `C:\dazbee-work\textmatch\models\r2-r18-strong` on envy if envy only lost network). |
| Far more samples | 192 a face drawn on envy (1.56M samples, 16 GB); training stopped on purpose (about 5 h on the shared GPU). `--aug strong` implemented. |
| Hard-negative mining | Not done. |
| Multi-word voting | Not done; windows from all words are already averaged. |
| Pseudo-label adaptation on DeltaX | Not possible: no DeltaX block passes the rule, so there are no confident labels. |
| Fingerprint vote + 5 finalists | Done. |

### Timing

Measured separately: one evaluation at a time, on one logical CPU, over 12 ads and 56 blocks, three runs each, with the w32 library model; median and spread. The laptop was shared throughout (other processes used 300–700 CPU-seconds during each run; recorded in `.data/results/timing-busy.txt`).

| Mode | Version | Per block, median | Per block, p95 | Per ad, median | Per ad, p95 | Startup | Peak RSS |
|---|---|---|---|---|---|---|---|
| 321 families | Light | 314 ms (285–568) | 4.0 s | 3.3 s (3.2–5.0) | 45 s | 4–23 s | 622 MB |
| 321 families | Medium | 1.59 s (1.57–3.0) | 15.8 s | 17.2 s (13.9–26.2) | 226 s (205–474) | 4–23 s | 622 MB |
| Whole library | Light | 332 ms (332–480) | 2.3 s | 2.6 s (2.0–3.2) | 35 s | 1.8–10 s | 1,268 MB |
| Whole library | Medium | 1.71 s (1.70–2.65) | 12.0 s | 12.4 s (10.3–17.7) | 238 s | 1.8–10 s | 1,268 MB |

The per-ad p95 comes from one ad, the 378-px-tall hollow "VOLT" block. The w48 model adds about 0.1–0.2 s per block. Full-run times elsewhere were taken on the shared machine; accuracy figures are unaffected.

Old worker: on one core, 1 of 11 ads finished (127 s) and 10 failed at its 150 s search limit, peak private memory 1.24 GB; on four cores, 32 of 48 finished (median 92 s, p95 152 s, max 188 s), 16 failed, peak 5.1 GB.

Data sizes: the library clone is 2.7 GB, the catalogue 292 MB, and each 48-a-face sample set of the library 4.0 GB.

## Examples

Each picture is: block | old worker's choice drawn by Dazbee | Light | Medium, from development ads, in the git-ignored `.data/`:
- 14 in Dazbee's 321-family mode: `.data/examples-sub/*.png`
- The same 14 in whole-library mode: `.data/examples-lib/*.png`
- The 20 judged pairs: `.data/judge/01.png`–`20.png`, with `judge.json` and `verdicts.json`.

## What production needs

**Code:** `packages/text-match` (schema, fonts, renderer, onnxruntime-node) in feature files: measure, fingerprint, fit, rank, score, match. Job contracts `TextMatchJob` and `TextMatchResult` in `packages/schema`. ADR-0001's `apps/worker`: one worker thread per CPU, each with one CanvasKit, one ORT session and a font registry under a byte budget (not an API thread: Medium takes tens of seconds and CanvasKit's wasm memory only grows). Fonts from storage by hash, in a local disk cache.

**Building and refreshing:** a font import or a brand upload queues a fingerprint build (draw 8 samples a face, embed them, store the fingerprints keyed by model hash). Retraining is one command on the 4070 Super after drawing samples on CPU; it belongs in ADR-0001's `python/` workspace, while sample drawing stays TypeScript.

**Must-dos before shipping:** a calibrated keep-as-picture rule; a capped working scale for large blocks; static int8 or fp16 for the model; checkpoints saved every epoch.

**Tests:** Sharma's CIEDE2000 pairs; a drawn-then-recovered round trip; a frozen held-out regression set.

## Risks

- The keep-as-picture decision is currently unusable on AI ads (see the threshold check).
- AI lettering is often no real font, so "exact" is unreachable and closeness is the goal.
- Outline detection mistakes matting fringes for outlines (seen on development ads; not fixed).
- Huge blocks make Medium slow.
- Library mode needs about 2× the memory.
- ImageNet weights' terms need checking if a pretrained backbone is adopted.
- Lens is non-commercial.

## Blocked or incomplete

- envy went offline twice (a reboot at 11:56 and again around 15:4x IST). Lost: the first bigger run at epoch 6 (rerun and completed), the library w48 at 48 a face, and the ResNet-18 run near its end. The 192-a-face run was stopped on purpose.
- Graphic-Design-Bench is not run yet.
- Cleanup: envy holds about 30 GB in `C:\dazbee-work\textmatch` (samples, Google Fonts clone, code clone, models); this PC about 15 GB in the git-ignored `.data`. Both can be deleted once the owner decides.
