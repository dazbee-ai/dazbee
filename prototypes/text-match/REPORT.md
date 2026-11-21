# Text matcher prototype: report

This is a prototype and is never merged. It answers one question: what is the most accurate way to turn a text block from a flat ad picture into an editable Dazbee text layer on a one-CPU server, and how close can a lean Light version get to Medium?

The prototype skill offers two kinds of prototype: a logic walkthrough or a UI. This question is neither, so the prototype is a measuring harness run from the command line, plus this report.

## Round 3 headline (2026-11-22)

Medium against the whole library, on the test parts, each scored once at the end. **Before** is round 2's final setup (the 32-px w48 model trained on clean samples, finalists decided by v1); **after** is round 3's (ConvNeXt-Atto from ImageNet trained on realistic 64-px samples, the owner's rule with a colour guard, the steps below). Every result was scored again by every rule with `src/rescore.ts`.

| Test part               | Blocks | Looks the same: owner's rule + colour guard | Same at the looser ink bar 0.20 | v1 / v2                       | Same family       | Exact face                                |
| ----------------------- | ------ | ------------------------------------------- | ------------------------------- | ----------------------------- | ----------------- | ----------------------------------------- |
| Synthetic               | 240    | 87.1% → **90.8%**                           | 87.9% → 92.1%                   | 28.3% / 43.3% → 26.7% / 41.7% | 67.9% → **78.3%** | 52.9% → **61.7%**                         |
| Our own realistic set   | 300    | 87.3% → **92.0%**                           | 89.0% → 93.7%                   | 24.3% / 37.3% → 27.3% / 39.7% | 66.0% → **76.3%** | 51.3% → **62.3%**                         |
| LICA                    | 668    | 80.4% → **81.9%**                           | 83.2% → 83.8%                   | 16.0% / 47.8% → 16.0% / 49.9% | 51.3% → **60.3%** | 43.4% → **49.7%** (632 with a known face) |
| test-ad, all 48 ads      | 221    | 90.5% → **92.8%**                           | 95.0% → 96.4%                   | 0% / 0.9% → 0% / 1.4%         | –                 | –                                         |
| test-ad, 16 held-out ads | 69     | 92.8% → **95.7%**                           | 97.1% → 98.6%                   | 0% / 0% → 0% / 1.4%           | –                 | –                                         |

- **The colour guard** (ink colour within ΔE00 10) turns down, of the blocks the fitted rule alone passes: after, 12 on our own set (gradients, outlines, eroded small print), 2 synthetic, 2 LICA, 0 test-ad; before, 19, 7, 3 and 1.
- **The old worker**, on the 130 test-ad blocks it answered, looks the same 104 times (80%) by the new rule; round 2's Medium 117 and round 3's 120 on the same blocks.
- **Time and memory**, one core of the laptop, the same 12 test ads as round 2's timing (56 blocks), three runs, median (spread): per block 1.33 s (1.27–1.44) → 1.35 s (1.10–1.42), p95 9.8 s → 9.8 s; per ad 9.7 s → 10.2 s, p95 162 s → **17 s** (the capped working scale); peak RSS 850 MB → 1,113 MB. The old worker on one core finished 1 of 11 ads within its 150 s limit; on four cores it took 92 s an ad and 5.1 GB.
- **Model:** 14.9 MB float (3.7M parameters), 3.3 ms a window on one thread of envy (6.7 ms on the laptop); fingerprints 16.7 MB at 512 numbers, or 4.2 MB at 128 with the same accuracy.

## Round 3 recommendation

1. **Use ConvNeXt-Atto from ImageNet, trained on the realistic samples, in Medium with the round 3 steps.** It is the most accurate on every set: family +10 points on the synthetic and our own test parts and +9 on LICA, exact face +6 to +11, and "looks the same" up on every set, test-ad's held-out ads included (92.8% → 95.7%). The owner accepted ImageNet weights on 2026-11-22.
2. **Store 128 fingerprint numbers** (`train/pca.py`): the same accuracy as 512 on the development parts, and the gallery falls from 16.7 MB to 4.2 MB.
3. **Keep the model in float32.** int8 makes it 4.2 MB instead of 14.9 MB but costs 3–5 points of family end to end on the realistic sets, and it is slower for ConvNeXt on both CPUs measured.
4. **If speed or size must win,** the distilled MobileNetV4-Conv-Small (9.0 MB, 0.8 ms a window on envy, 4× faster) keeps most of the gain over round 2 (LICA family 65.2% against 56.8% on the development part) but trails ConvNeXt by 2.5–5 points of family. The fingerprint is a small share of a block's time (1.35 s median, mostly drawing), so this buys little.
5. **Decide "looks the same" by the owner's fitted rule with the colour guard.** It keeps 92.8% of test-ad text live (95.7% on the held-out ads) where v1 kept none.
6. **Budget about 1.2 GB a worker,** or recycle a worker past a memory budget: peak memory rose to 1.1 GB (see below), above the 0.6 GB target.
7. **More data is still the strongest lever:** twice the samples and 16 epochs moved the fingerprint score from 51.5 to 60.0. A next round can draw 4–8 sets more (about 45 min each on envy) and train longer.

## Round 3: what was done

### Test sets, frozen before any training

Each set has a development part (checkpoints and settings were chosen on it) and a test part, scored once at the end. Code: `src/make-realistic.ts`, `src/lica.ts`, `src/sets.ts`.

| Set                       | Blocks, development / test    | What it is                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Synthetic (round 1)       | 120 / 240                     | Dazbee-drawn blocks made to look generated (blur, lost resolution, noise, colour drift); cut-outs and flat crops; Latin, Arabic, Devanagari.                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **Our own realistic set** | 150 / 300                     | Ad-like blocks drawn by Dazbee's renderer in known library faces (half in Dazbee's 321 families): headlines (1–2 lines, 40–110 px), subheads, prices and offers, small print (11–16 px), buttons, Hindi and Arabic. Gradients 20%, outlines 12%, drop shadows 12%, tight and loose spacing, 10% tilted. Set over the background layers of 16 test-ad development ads, then cut out as a matting step does: soft or eroded edges, halos of the background, specks, alpha noise. Its words are kept apart from the training samples' words.                                                                            |
| **LICA**                  | 417 / 668                     | Text components of the LICA dataset (1,148 layouts), each cropped from its layout's picture with its labelled `fontFamily` and weight, and cut out by its labelled text colour (pixels within 15% of the way from the text's colour to the crop border's median are ink, past 75% none). Kept: families in our library (126), level, at least 3 characters, no other text within 0.3 em, line breaks certain (one line, or the text's own breaks), at most 20 a family. Split by template: a third are development. 60 blocks whose face the library lacks at the labelled weight count for family only. All Latin. |
| real test ads           | 152 / 69 blocks (32 / 16 ads) | Unchanged: the 16 held-out ads were never opened. No font truth, so only "looks the same", SSIM and ΔE.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

LICA: dataset by LICA (github.com/purvanshi-lica/lica-dataset), data from `https://storage.googleapis.com/lica-assets/websites/blog/lica-data.zip`, licensed CC BY 4.0. It was used for testing and for choosing checkpoints only. Neither the crops nor the layouts' pictures are committed or shipped: they live in the git-ignored `.data/lica` and in `C:\dazbee-work\textmatch\lica` on envy.

### Training data closer to real ads

- **2.06M new samples** of the whole library (8,143 faces, about 252 a face in four sets of 64; `src/make-samples.ts --realistic`, `src/realistic.ts`): one line each, drawn by Dazbee's renderer at 11–90 px, with letter spacing jittered as DeepFont does (N(10, 38)% clipped to 0–48%, which is DeepFont's N(10, 40) px at 105 px; plain 45% of the time, tight 15%), outlines 12%, drop shadows 10%, gradients 20%. Each is set over the other 16 development ads' background layers (or a made background), then cut out with spoilt edges (75%) or kept flat with block noise (25%), and read by the matcher's own steps (ink, line, strip) into a 64-px strip. Drawing took 33–49 min a set on envy's CPU.
- **On the GPU** (`train/augment.py`), each window is squeezed across by 5/6–7/6 (DeepFont), sheared, turned up to 2°, given perspective (40%), jittered per glyph (bands of the window moved up to 2 px up or down and 1 px sideways, 50%), wobbled (30%), lowered in resolution to 12–48 px (40%), blurred (σ up to 1.6), JPEG-blocked at quality 20–85 (30%), noised, faded, and thickened or thinned (20%).
- The round 2 samples (32 px high) could not be reused: the 64-px input needs new strips.

### The trainer

`train/train2.py`, with `train/evaluate2.py` (measuring) and `train/finish2.py` (extras, export, int8):

- Input: 64×256 windows of one ink channel. Each backbone's 2×8 output is averaged over the width only, so where strokes sit up and down is kept; then LayerNorm and a 512-number fingerprint.
- Loss: CosFace (s 30, m 0.2) over 7,425 classes. Faces whose drawn probes are near-identical (cosine ≥ 0.995 of the same test letters drawn alike, `src/face-probes.ts`) share a class: 8,143 faces become 7,425 classes. A family head (1,998 families, weight 0.3) sits beside it.
- Confusable batches from epoch 3: half of every batch is a class and its 3 nearest classes by the head's weights, 2 samples each, refreshed every epoch.
- AdamW (lr 2e-3 from scratch, 1e-3 pretrained; weight decay 0.05), 3% warm-up, cosine decay; only the heads train in the first epoch of a pretrained start; bf16 with the margin logits in fp32; channels_last; an EMA of the weights (0.9995); windows 48 px high for the first 30% of epochs.
- The whole state (model, EMA, heads, optimiser, step, random state) is saved every epoch, written to a temporary file and renamed, so a cut never leaves a half-written checkpoint, and a run resumes from it. This was used once: envy lost power at 01:11 during the control's longer run, which resumed from epoch 6.
- Checkpoints are chosen by the mean of face and family top-1 on the own and LICA development parts, at the fingerprint level (nearest class mean over a gallery of 8 clean samples a face), never by the loss.

### Recogniser comparison (12 epochs on 1.03M samples each; fingerprint level, development parts)

Round 2's model on the same development blocks (read at 32 px): own face / family top-1 32.0 / 43.3, LICA 39.2 / 51.6, synthetic 45.0 / 59.2; score 41.5.

The score is the mean of face and family top-1 on the own and LICA development parts; every number is a percentage at the chosen epoch (`python train/compare2.py`).

| Run                                                                                  | Weights from                                  | Licence label of the weights                                                                                  | Chosen epoch | Score    | Own face top-1 / top-25 | Own family top-1 / top-25 | LICA face top-1 / top-25 | LICA family top-1 / top-25 | Synthetic face / family top-1 | Minutes an epoch |
| ------------------------------------------------------------------------------------ | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------ | -------- | ----------------------- | ------------------------- | ------------------------ | -------------------------- | ----------------------------- | ---------------- |
| Round 2's model (32 px)                                                              | scratch                                       | ours                                                                                                          | –            | 41.5     | 32.0 / 64.7             | 43.3 / 75.3               | 39.2 / 65.4              | 51.6 / 77.0                | 45.0 / 59.2                   | –                |
| Our own net (control)                                                                | scratch                                       | ours                                                                                                          | 12           | 48.7     | 44.7 / 89.3             | 58.7 / 92.7               | 37.9 / 73.0              | 53.7 / 80.6                | 49.2 / 67.5                   | 4.2              |
| **ConvNeXt-Atto**                                                                    | timm `convnext_atto.d2_in1k`                  | timm code Apache-2.0; ImageNet-1k weights (ImageNet's non-commercial terms: the grey area the owner accepted) | 12           | **51.5** | 44.7 / 89.3             | 62.0 / 92.7               | 42.0 / 74.8              | 57.3 / 82.0                | 51.7 / 69.2                   | 3.4              |
| ResNet-18                                                                            | timm `resnet18.a1_in1k`                       | as above                                                                                                      | 12           | 48.0     | 40.7 / 89.3             | 61.3 / 92.0               | 37.4 / 70.0              | 52.8 / 78.9                | 42.5 / 67.5                   | 3.1              |
| MobileNetV4-Conv-Small                                                               | timm `mobilenetv4_conv_small.e2400_r224_in1k` | as above                                                                                                      | 11           | 47.6     | 41.3 / 88.0             | 59.3 / 92.0               | 36.9 / 71.0              | 52.8 / 79.4                | 41.7 / 64.2                   | 2.5              |
| **ConvNeXt-Atto, longer** (2.06M samples, 16 epochs)                                 | as ConvNeXt-Atto                              | as above                                                                                                      | 14           | **60.0** | **56.0 / 94.0**         | **69.3 / 94.0**           | **48.9 / 81.4**          | **65.7 / 86.8**            | **60.0 / 75.0**               | 6.4              |
| Control, longer (stopped at epoch 6 of 16)                                           | scratch                                       | ours                                                                                                          | 6            | 43.0     | 34.0 / 86.7             | 52.0 / 90.0               | 35.1 / 71.0              | 51.1 / 77.0                | 40.8 / 62.5                   | 8.4              |
| MobileNetV4-Conv-Small distilled from the longer ConvNeXt (1.03M samples, 16 epochs) | MobileNetV4's ImageNet start                  | as above                                                                                                      | 16           | 51.5     | 42.0 / 86.7             | 62.0 / 90.0               | 44.3 / 76.3              | 57.6 / 82.0                | 47.5 / 68.3                   | 3.0              |

End to end on the development parts (Medium, the round 3 steps; family / exact face):

| Model                                                                        | Own             | LICA            | Synthetic       |
| ---------------------------------------------------------------------------- | --------------- | --------------- | --------------- |
| Round 2's setup                                                              | 60.7 / 49.3     | 56.8 / 44.3     | 72.5 / 57.5     |
| Control (12 epochs), closest passing finalist                                | 73.3 / 56.0     | 59.5 / 44.0     | 78.3 / 60.8     |
| ConvNeXt-Atto (12 epochs), the same                                          | 78.0 / 60.0     | 58.5 / 43.3     | 76.7 / 59.2     |
| ConvNeXt-Atto, longer, the same                                              | 77.3 / 60.0     | 65.5 / 46.3     | 75.8 / 60.0     |
| **ConvNeXt-Atto, longer, + the fingerprint's vote in the final pick (0.25)** | **76.0 / 62.7** | **70.0 / 51.7** | **79.2 / 64.2** |

The winner is the longer ConvNeXt-Atto run. On the same data and epochs ConvNeXt-Atto led the control by 2.8 points; with twice the data and 16 epochs it reaches 60.0, 18.5 points over round 2's model, and it is the most accurate end to end. Its fingerprint gains show end to end on LICA (family +7 points over the 12-epoch run); on our own and the synthetic set the drawn comparison, not the shortlist, decides most blocks, and the fingerprint's vote in the final pick is what carries the gain there.

### Size and speed of every model

One thread, ONNX Runtime, a batch of 8 windows (`src/bench-model.ts`). int8 is static QDQ, per channel, calibrated on 512 realistic windows (`train/finish2.py`). The gallery is the face fingerprints: 8,143 faces × the fingerprint's numbers × 4 bytes.

| Model                          | Input  | Parameters | Float ONNX  | int8 ONNX | ms a window, envy (Ryzen 7 7700), float / int8 | ms a window, laptop (Ryzen 5 4600H), float / int8 | Fingerprint score, float / int8 |
| ------------------------------ | ------ | ---------- | ----------- | --------- | ---------------------------------------------- | ------------------------------------------------- | ------------------------------- |
| Round 2's w48                  | 32×128 | –          | 17.2 MB     | –         | 8.7 / –                                        | 16.4 / –                                          | 41.5 / –                        |
| Our own net (control)          | 64×256 | 4.53M      | 18.1 MB     | 4.6 MB    | 9.0 / 6.9                                      | 15.4 / 17.8                                       | 48.7 / –                        |
| ResNet-18                      | 64×256 | 11.70M     | 46.8 MB     | 11.8 MB   | 6.6 / 5.5                                      | 14.8 / 14.7                                       | 48.0 / –                        |
| MobileNetV4-Conv-Small         | 64×256 | 3.48M      | 9.0 MB      | 2.5 MB    | 0.84 / 0.68                                    | 1.45 / 1.80                                       | 47.6 / –                        |
| **ConvNeXt-Atto (the winner)** | 64×256 | 3.70M      | **14.9 MB** | 4.2 MB    | **3.3** / 5.2                                  | 6.7 / 16.5                                        | **61.1** / 60.2                 |
| MobileNetV4 distilled from it  | 64×256 | 3.48M      | 9.0 MB      | 2.5 MB    | 0.83 / 0.68                                    | –                                                 | 53.6 / 50.4                     |

The envy column was measured on a quiet machine; the laptop column while it was partly shared (other sessions' processes), so read it for order, not exact values. The fingerprint scores here use the gallery each model was finished with (clean and realistic samples together for the last two; clean for the others).

**The gallery**, for the 8,143 faces of the whole library: 16.7 MB at 512 numbers, 8.3 MB at 256, **4.2 MB at 128**, each 2× smaller again as float16. Fewer numbers cost nothing measurable (score 61.1 at 512, 61.3 at 256, 61.2 at 128; end to end below).

**int8** (static QDQ, per channel, fingerprints rebuilt with the int8 model): 3.5–4× smaller files. On ConvNeXt-Atto it costs 0.9 points at the fingerprint level but 3–5 points of family end to end on the realistic development parts (own 76.0 → 72.7, LICA 70.0 → 65.0, synthetic 79.2 → 79.2; exact face 62.7 → 60.0, 51.7 → 48.3, 64.2 → 56.7), and it is slower than float for ConvNeXt on both CPUs. It is not kept.

### Extras

Measured on the development parts with the longer ConvNeXt-Atto unless named (fingerprint score as in the comparison; end to end as family / exact face on own, LICA, synthetic).

| Extra                                                                                                                                    | Result                                                                                                                                                                                        | Kept                                                                   |
| ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Gallery of clean samples (8 a face)                                                                                                      | score 60.0                                                                                                                                                                                    |                                                                        |
| Gallery of realistic samples (8 a face)                                                                                                  | 55.3                                                                                                                                                                                          |                                                                        |
| **Gallery of both (16 a face)**                                                                                                          | **61.1**                                                                                                                                                                                      | yes                                                                    |
| Test-time voting over squeezes 0.9 / 1 / 1.1                                                                                             | 60.5 (−0.6); end to end with the control model: own 72.7 / 56.7 vs 73.3 / 56.0, synthetic 79.2 / 61.7 vs 78.3 / 60.8                                                                          | no                                                                     |
| Test-time voting over squeezes 0.85 / 1 / 1.15                                                                                           | 60.0 (−1.1)                                                                                                                                                                                   | no                                                                     |
| AdaBN on the test-ad development ads' blocks (unlabelled, never the held-out ads)                                                         | ConvNeXt-Atto has no batch norm (LayerNorm only), so it doesn't apply; on the distilled MobileNetV4 it falls from 53.6 to 36.6                                                                | no                                                                     |
| **128 fingerprint numbers (PCA on the gallery, `train/pca.py`, `FP_PCA=128`)**                                                           | 61.2; end to end (without the final vote) own 76.7 / 60.0 vs 77.3 / 60.0, LICA 65.9 / 46.8 vs 65.5 / 46.3, synthetic 77.5 / 61.7 vs 75.8 / 60.0; same time                                    | **recommended for production** (4.2 MB gallery)                        |
| **The fingerprint's vote in the final pick** (`FINAL_FUSE`, the closest passing finalist by the rule's closeness plus 0.25 × similarity) | 0: 77.3 / 60.0, 65.5 / 46.3, 75.8 / 60.0; **0.25: 76.0 / 62.7, 70.0 / 51.7, 79.2 / 64.2**; 0.5: 74.0 / 62.7, 69.3 / 51.7, 78.3 / 65.0; 1: 73.3 / 62.7, –, 77.5 / 63.3                         | yes, 0.25                                                              |
| A heavier vote in the rank (FUSE 1 with the final vote 0.25)                                                                             | 76.0 / 61.3, 70.7 / 51.4, 78.3 / 63.3                                                                                                                                                         | no (FUSE stays 0.5)                                                    |
| **The closest passing finalist instead of the first** (control model)                                                                    | own 70.7 / 52.7 → 73.3 / 56.0, synthetic 78.3 / 54.2 → 78.3 / 60.8                                                                                                                            | yes                                                                    |
| Distillation into MobileNetV4-Conv-Small (teacher's and student's views identical, KL on logits at T 2, 16 epochs)                       | score 53.6 against the teacher's 61.1 and 47.6 for MobileNetV4 trained directly; end to end 72.0 / 58.0, 65.2 / 50.4, 76.7 / 56.7 against the teacher's 76.0 / 62.7, 70.0 / 51.7, 79.2 / 64.2 | an option if speed or size must win (4× faster than the teacher, 9 MB) |

### Matcher changes

- **Novelty faces left out** (`train/novelty.py`, from each face's drawn probe): a face whose ink spreads where letters have none is left out of the candidates, as colour fonts are. The test is general, with no list of names: faint ink 3 px or more from any solid ink (solid relative to the face's own darkest ink) over 5% of the text's box, which is a pattern's fill (the faint grid of the "Charted" faces); or no gap between letters with ink running unbroken across 90% of the line (blocks, bars, waves). It drops 41 faces in 39 families, among them every "Charted" face (so "Jersey 15 Charted", picked for concert_echo block 1, can no longer be chosen; plain "Jersey 15" stays), Redacted, Flow Block, Linefont, Wavefont, Rubik Maps, Rubik Microbe and the thin Bitcount Grid weights. It also drops a few real but rare ones: Ballet and Imperial Script (hairline scripts) and the thinnest weights of Kalnia and Montserrat Underline. The list is `.data/fonts/novelty.json`, made by `python train/novelty.py --probes samples/lib-probes --out …`.
- **The owner's fitted "looks the same" rule** (`src/rule.ts`, copied from the judging work) now decides, with a colour guard it lacks: the median colour of the ink both pictures share (its core, 1 px in) must be within ΔE00 10 (`src/score.ts`). v1 and v2 are kept beside it. `node src/rescore.ts <results>` scores any stored result again by every rule and `node src/summary2.ts <results>` reports them, so a recalibrated rule is one function and a rescore away.
- **The finalist that wins** is the closest of those that look the same (the rule's SSIM less the share of ink left uncovered, plus 0.25 × the fingerprint's similarity); before, it was the first in rank.
- **A capped working scale:** a block whose lines are taller than 160 px is matched shrunk to 160 px a line, scaled back and scored once at full size.
- **A coverage index** (`src/coverage.ts`): which of 1,855 characters each of the 5,523 font files draws, kept as a bitset (1.3 MB), so checking a candidate needs no typeface loaded; characters outside it fall back to loading the face.

### Memory

Peak RSS on the 12 timing ads, one core: 850 MB before, 1,113 MB after (1,084 MB with 128 numbers), so the 0.6 GB target is not met. Logging memory after every block (`rssMb` in each result) shows where it goes: it steps up by 50–180 MB at blocks whose shortlist holds large CJK files that also cover Latin (Shippori Mincho, Zen Maru Gothic, Noto Serif HK), because CanvasKit's WebAssembly memory only grows. The new model shortlists such families more often than round 2's did.

- Tried: registering only the face being drawn instead of the whole shortlist: the same answers, but 1,334 MB and 2.5× slower (the heap fragments as fonts come and go). Not kept.
- Tried: ONNX Runtime without its arena and in batches of 8 windows: 1,093 MB, no real change. Not kept.
- What does help: the coverage index replaced round 2's cache of up to 200 MB of typefaces held only for checking letters.
- For production: give a worker about 1.2 GB, or recycle its thread after a budget (a fresh CanvasKit returns the memory); a byte budget per registration (fitting the shortlist in groups of at most, say, 64 MB of font files) is the next thing to try.

### Decisions

- Decision (Claude, 2026-11-21): our own set's backgrounds are the background layers of 16 test-ad development ads; the training samples use the other 16; no held-out ad's pixels are used anywhere.
- Decision (Claude, 2026-11-21): LICA blocks are cut out by their labelled colour, as the layering job gives cut-outs; blocks whose line breaks are uncertain are dropped rather than guessed.
- Decision (Claude, 2026-11-21): faces whose drawn probes are near-identical (cosine ≥ 0.995) train as one class; "exact face" is still scored strictly.
- Decision (Claude, 2026-11-21): backbones and checkpoints are compared by the mean of face and family top-1 on the own and LICA development parts; the matcher's settings by its family and exact face on the development parts.
- Decision (owner, 2026-11-22): ImageNet-pretrained weights are accepted for accuracy. The recogniser is picked by accuracy on the realistic development sets, then size and speed, pretrained or not. The control's longer run was stopped at epoch 6 of 16 when this was decided, and the GPU went to the pretrained winner.
- Decision (Claude, 2026-11-22): the closest passing finalist wins; the fingerprint's vote stays at 0.5; 5 finalists; the working scale is capped at 160 px a line; novelty faces are left out; a block's colour must be within ΔE00 10 to look the same.
- Decision (Claude, 2026-11-22): the winner is the longer ConvNeXt-Atto run (epoch 14 of 16), with a gallery of 8 clean and 8 realistic samples a face, no test-time views, no AdaBN, float32, and the fingerprint's vote of 0.25 in the final pick.
- Decision (Claude, 2026-11-22): the test parts were scored once, after every setting above was fixed on the development parts. Round 2's setup was run on the new test parts frozen as it was (RULE=v1, first passing finalist, no novelty list, no working-scale cap).

### What didn't help

- A heavier fingerprint vote (FUSE 1 or 2 instead of 0.5): family −3.4 and −6.0 points on our own development part (control model).
- 8 finalists instead of 5: no gain (family −0.6, face −1.3 on our own development part), slower.
- A 96-px working scale: −2 points of "looks the same" on our own development part (round 2's model); 160 px costs nothing there.
- int8 for speed: on the laptop's Ryzen 5 4600H it is no faster than float; on envy's Ryzen 7 7700 it is 1.2–1.3× faster for the batch-norm nets but slower for ConvNeXt-Atto. It makes the files 3.5–4× smaller.
- Measuring a run while it trains on 48-px windows: its numbers sit far below its 64-px numbers (control: epoch 4 score 15.7, epoch 5 36.3), so only the 64-px epochs are compared.
- MobileNetV4-Conv-Small and ResNet-18 from ImageNet trailed both ConvNeXt-Atto and the from-scratch control.
- int8 end to end: 3–5 points of family lost on the realistic development parts; slower than float for ConvNeXt.
- AdaBN: not applicable to ConvNeXt (no batch norm); on the distilled MobileNetV4 it cost 17 points of the fingerprint score.
- Test-time voting over squeezes: −0.6 and −1.1 on the fingerprint score; mixed by one or two blocks end to end.
- A realistic-only gallery: 55.3 against 60.0 for a clean one (the two together: 61.1).
- Registering only the face being drawn, and ONNX Runtime without its arena, to save memory: no saving (see Memory).
- Distillation (patient and consistent, 16 epochs) closed only part of the gap: the student scores 53.6 against its teacher's 61.1.

### For the owner to decide

- **Weights' licences.** The winner starts from timm's `convnext_atto.d2_in1k` (timm's code is Apache-2.0; the weights were trained on ImageNet-1k, whose terms are for non-commercial research). The owner accepted this grey area on 2026-11-22; the model card's own terms should be read once more before shipping. Our own net and the samples it is trained on are all ours; the fonts are the Google Fonts library's (OFL, Apache, UFL).
- **LICA (CC BY 4.0)** needs attribution only, and is used for testing alone. Keep it out of any training set and out of shipped files.
- **The novelty list** drops a few real fonts with it (Ballet, Imperial Script, the thinnest weights of Kalnia and Montserrat Underline). The Charted faces score 5–20% on the faint-ink measure and Ballet 13%, so no bar separates them; raising the bar to 7% would keep Imperial Script but let Micro 5 Charted and Rubik Maps back in. Recommended: accept the list as it is.
- **128 fingerprint numbers and float32** are the recommendation; int8 and the distilled MobileNetV4 are there if size or speed must win.
- **The memory target** (0.6 GB) is not met: accept about 1.2 GB a worker, or ask for the byte-budgeted registration.
- **Cleanup**, all made by this work:
  - envy: `C:\dazbee-work\textmatch` holds 78.8 GB: the sample sets 68.1 GB (round 2's 32-px sets about 17 GB, round 3's 64-px sets 51 GB plus galleries), models 4.2 GB, LICA 1.9 GB, the Google Fonts clone and code. The timm weights this work downloaded sit in `C:\Users\imkes\.cache\huggingface\hub\models--timm--{convnext_atto.d2_in1k,mobilenetv4_conv_small.e2400_r224_in1k,resnet18.a1_in1k}` (the other folders there are not this work's). The scheduled tasks `dazbee-*` can be deleted.
  - this PC: the git-ignored `.data` holds 20 GB (round 2 left 15 GB; this round added the 64-px galleries and validation set, about 4 GB, and the models).
  - To keep for a next round: the four realistic sets `samples\lib64-r1`–`r4` (51 GB), the probes and galleries, and `models\r3l-convnext_atto`.

## Round 2 headline (before round 3)

**Synthetic held-out test set** (240 blocks with exact ground truth, never looked at while building):

|                               | Looks the same (shared rule) | Looks the same (rule v2) | Same family                                    | Exact face | Time per block, one core, median (p95) |
| ----------------------------- | ---------------------------- | ------------------------ | ---------------------------------------------- | ---------- | -------------------------------------- |
| Light, whole library          | 20.4%                        | 31.7%                    | 63.3%                                          | 51.2%      | 0.33 s (2.3 s)                         |
| **Medium, whole library**     | **28.3%**                    | **43.3%**                | **67.9%**                                      | **52.9%**  | **1.7 s (12 s)**                       |
| Light, Dazbee's 321 families  | 12.9%                        | 20.4%                    | 45.0% (71.2% when the true font is in the 321) | 32.1%      | 0.31 s (4.0 s)                         |
| Medium, Dazbee's 321 families | 18.8%                        | 28.3%                    | 46.3% (72.9% when the true font is in the 321) | 31.7%      | 1.6 s (16 s)                           |

**real test ads** (221 text blocks in 48 ads; 16 held-out ads with 69 blocks are reported separately below):

|                 | Looks the same (shared / v2) | Median SSIM / ΔE                                                 | Per ad, median                                                                          |
| --------------- | ---------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Light, library  | 0% / 0%                      | 0.63 / 22.2                                                      | 2.6 s on 1 core                                                                         |
| Medium, library | 0% / 0.9%                    | 0.74 / 17.6                                                      | 12.4 s on 1 core                                                                        |
| Old worker      | 0% / 0.8% (1 of 130)         | 0.72 / 18.1 on its 130 blocks; ours on the same 130: 0.76 / 15.0 | 92 s on 4 cores; failed 16 of 48 ads at its 150 s limit; on 1 core, 10 of 11 ads failed |

- **Peak memory:** ours 0.6 GB (321 families) or 1.3 GB (whole library), against 5.1 GB for the old worker on 4 cores.
- **Size:** model 17.2 MB plus 4.2 MB of fingerprints for 8,143 faces.
- **Training:** 43 min on the RTX 4070 Super, after 2 × 4.6 min of drawing samples on envy.

## Round 2 recommendation (round 3 above replaces it where they differ)

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

## Round 1 and 2 decisions (Claude, 2026-11-21)

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
- **Tilt:** test-ad blocks use the cutting step's angle. Synthetic blocks get no angle, which tests the estimator.

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
- test-ad: every third ad by name is held out (16 ads). Their pictures and per-block results were never opened.
- Examples and judged pairs come from development ads only.
- The test part was scored three times in round 2: the bigger model, then the fingerprint vote, then a fix to the brand margin's units, which the vote had changed. The settings themselves were chosen on the development part.

## What the research says, and what was used

- **DeepFont** (https://arxiv.org/abs/1507.03196): synthetic training with degradations, patches averaged at test time; 71.4% / 81.8% top-1 / top-5 on real images. Used: the training recipe.
- **Chen et al., CVPR 2014** (https://openaccess.thecvf.com/content_cvpr_2014/html/Chen_Large-Scale_Visual_Font_2014_CVPR_paper.html): nearest class mean on a learned metric, so fonts can be added without retraining. Used: how faces are known.
- **Chen et al., ICCV 2019** (https://arxiv.org/abs/1909.02072): features that ignore the words. Used: random strings per sample, and fingerprints averaged over windows of different words.
- **Shimoda et al., ICCV 2021** (https://arxiv.org/abs/2110.01890): predict the parameters, then refine by rendering and comparing. Used: the whole Light/Medium design.
- **LayerD** (https://arxiv.org/abs/2509.25134): layer decomposition; the test-ad blocks are such cut-outs.
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

| Parameter           | Error        |
| ------------------- | ------------ |
| Size                | 1.5%         |
| Letter spacing      | 0.9 % points |
| Line height         | 0.03         |
| Colour              | ΔE 0.3       |
| Tilt                | 0.0°         |
| Outline found right | 88%          |

Looks the same (shared rule), by group (library, round 1, Medium): degradation none 53.7%, mild 28.9%, strong 3.9%; Latin 24.8%, Arabic 37.5%, Devanagari 30.2%; sans-serif 31.0%, serif 21.7%, display 18.2%, handwriting 33.3%; brand with the font in the kit 27%, no brand 28%. The strict rule fails nearly every strongly degraded block, even when the face is exactly right.

Same family by category (Light / Medium): sans-serif 64% / 66%, serif 54% / 59%, display 77% / 73%, handwriting 71% / 71%.

Round 1 against round 2 (whole library, Medium), looks the same shared / v2 and exact face: round 1 27.9% / 41.7%, 47.1%; bigger model alone 27.9% / 42.5%, 48.3%; bigger model + fingerprint vote + 5 finalists 28.3% / 43.3%, 52.9%. On Dazbee's 321, with the true font in the 321: family 66.9% → 72.9%, exact face 44.9% → 52.5%.

### real test ads

|                 | Median SSIM / ΔE, all blocks | Median SSIM / ΔE, held-out ads | Looks the same (shared rule) |
| --------------- | ---------------------------- | ------------------------------ | ---------------------------- |
| Medium, library | 0.74 / 17.6                  | 0.73 / 19.5                    | 0%                           |
| Light, library  | 0.63 / 22.2                  | 0.61 / 25.1                    | 0%                           |

Same family as the old worker: 4–11% (it picks from 7,036 faces, and near-identical families abound). Library against 321 families on real ads: about equal (Medium SSIM 0.74 against 0.73).

### Threshold check by eye (20 development pairs, Medium)

The eye says "looks the same" on 13 of 20. The shared rule, rule v2, the white-and-black variant and the blur-matched score each say 0 of 20 and agree with the eye 7 times. The pairs the eye passed have SSIM 0.67–0.94 and ΔE 4.9–22. AI lettering is never an exact real font, so pixel thresholds reject results that read as the same.

### Fingerprint scaling (held-out strips, face top-1)

| Model (samples a face, width)      | Faces | Top-1                     | Top-5                     | Top-1 on the 321   | Training time   |
| ---------------------------------- | ----- | ------------------------- | ------------------------- | ------------------ | --------------- |
| Catalogue, 6 / 12 / 24 / 48, w32   | 1,759 | 15.8 / 32.1 / 49.3 / 69.5 | 38.9 / 62.1 / 78.3 / 90.8 | same               | 1–3 min         |
| Catalogue, 48, w16 / w48           | 1,759 | 59.3 / 73.4               |                           |                    | 2 / 5 min       |
| Library, 12 / 24 / 48, w32         | 8,143 | 36.9 / 51.7 / 61.3        | 64.9 / 77.8 / 84.1        | 51.2 / 67.7 / 78.4 | 6 / 12 / 14 min |
| Library, 48, w16                   | 8,143 | 51.4                      | 78.0                      | 68.4               | 22 min          |
| **Library, 96, w48 (bigger run)**  | 8,143 | **70.8**                  | **88.9**                  | **87.2**           | 43 min          |
| Hand-written features (47 numbers) | 1,759 | 5.3                       | 12.0                      | —                  | —               |

- Data matters most: each doubling of samples a face added 10–20 points of top-1.
- But it no longer moves the end result: the bigger run's +9.5 points of top-1 moved Medium's looks-the-same by only +0.4 points. The bottleneck is now choosing within the shortlist and the rule itself.
- Model sizes: w16 2.0 MB, w32 7.7 MB, w48 17.2 MB. Speed per window, one thread: 3 / 12 / 29 ms.
- int8: dynamic quantisation makes the model 4.3 MB with the same accuracy (top-1 71.0% against 70.7%), but ORT's dynamic convolutions are about 20× slower. Use static QDQ int8 or fp16 instead.
- GPU: the laptop's GTX 1650 managed about 125 s an epoch on 84k samples; the 4070 Super is about 10× faster. A 192-samples-a-face, w48 run is about 1.5 h alone on the 4070 Super; by the curve it would bring about +4–6 points of top-1 and probably under 1 point of looks-the-same. Cloud GPUs aren't needed.

### Round 2 status

| Item                                                                                                       | Status                                                                                                                                                                                                                                   |
| ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ImageNet ResNet-18 (torchvision, BSD-3 code; ImageNet's own terms are a grey area) + stronger augmentation | Reached at least epoch 8 of 12; envy went offline before its final metrics; no per-epoch checkpoints, so it must be rerun (it may have finished into `C:\dazbee-work\textmatch\models\r2-r18-strong` on envy if envy only lost network). |
| Far more samples                                                                                           | 192 a face drawn on envy (1.56M samples, 16 GB); training stopped on purpose (about 5 h on the shared GPU). `--aug strong` implemented.                                                                                                  |
| Hard-negative mining                                                                                       | Not done.                                                                                                                                                                                                                                |
| Multi-word voting                                                                                          | Not done; windows from all words are already averaged.                                                                                                                                                                                   |
| Pseudo-label adaptation on test-ad                                                                          | Not possible: no test-ad block passes the rule, so there are no confident labels.                                                                                                                                                         |
| Fingerprint vote + 5 finalists                                                                             | Done.                                                                                                                                                                                                                                    |

### Timing

Measured separately: one evaluation at a time, on one logical CPU, over 12 ads and 56 blocks, three runs each, with the w32 library model; median and spread. The laptop was shared throughout (other processes used 300–700 CPU-seconds during each run; recorded in `.data/results/timing-busy.txt`).

| Mode          | Version | Per block, median  | Per block, p95 | Per ad, median     | Per ad, p95     | Startup  | Peak RSS |
| ------------- | ------- | ------------------ | -------------- | ------------------ | --------------- | -------- | -------- |
| 321 families  | Light   | 314 ms (285–568)   | 4.0 s          | 3.3 s (3.2–5.0)    | 45 s            | 4–23 s   | 622 MB   |
| 321 families  | Medium  | 1.59 s (1.57–3.0)  | 15.8 s         | 17.2 s (13.9–26.2) | 226 s (205–474) | 4–23 s   | 622 MB   |
| Whole library | Light   | 332 ms (332–480)   | 2.3 s          | 2.6 s (2.0–3.2)    | 35 s            | 1.8–10 s | 1,268 MB |
| Whole library | Medium  | 1.71 s (1.70–2.65) | 12.0 s         | 12.4 s (10.3–17.7) | 238 s           | 1.8–10 s | 1,268 MB |

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

**Must-dos before shipping:** the owner's fitted keep-as-picture rule with the colour guard (done in the prototype, `src/score.ts`); the capped working scale (done, 160 px a line); checkpoints saved every epoch (done, `train/train2.py`); 128-number fingerprints (`train/pca.py`); a memory budget per worker (see round 3's Memory).

**The model:** ConvNeXt-Atto (timm) from ImageNet, 64×256 windows, trained by `train/train2.py` on realistic samples from `src/make-samples.ts --realistic`; ONNX float32, 14.9 MB.

**Tests:** Sharma's CIEDE2000 pairs; a drawn-then-recovered round trip; a frozen held-out regression set.

## Risks

- The keep-as-picture rule rests on 120 judged pairs and reads no colour; the colour guard is a conservative patch (see round 3).
- AI lettering is often no real font, so "exact" is unreachable and closeness is the goal.
- Outline detection mistakes matting fringes for outlines (seen on development ads; not fixed).
- Huge blocks made Medium slow; the capped working scale brings the slowest ad from 162 s to 17 s.
- Peak memory is 1.1 GB a worker with the whole library (CJK font files in shortlists).
- ImageNet weights' terms: accepted by the owner for accuracy (2026-11-22); recheck the model card before shipping.
- Lens is non-commercial.

## Blocked or incomplete

- envy went offline twice (a reboot at 11:56 and again around 15:4x IST). Lost: the first bigger run at epoch 6 (rerun and completed), the library w48 at 48 a face, and the ResNet-18 run near its end. The 192-a-face run was stopped on purpose.
- envy lost power again at 01:11 on 2026-11-22, during round 3's longer control run; it resumed from its epoch-6 checkpoint, and was then stopped on purpose when the owner accepted pretrained weights.
- Graphic-Design-Bench is not run yet.
- Cleanup: see round 3's "For the owner to decide" (envy 78.8 GB, this PC 20 GB).
