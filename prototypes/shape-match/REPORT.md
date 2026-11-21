# Shape matcher prototype: Light and Medium

PROTOTYPE, never merged. Branch `shape-match-prototype`. It answers one question: how should Dazbee's Layering job vectorise the non-text blocks of a flat ad, and is a lean version (Light) as accurate as a fuller one (Medium) on a one-CPU server?

## Round 2: the current answer

Round 1 is kept below for its research, design and first measurements; where they differ, this section holds.

### Headline: the ladder against the old worker on the same rule

The old worker's own answers (its shapes regression's output on one core) were turned into Dazbee graphics, drawn by Dazbee's renderer and scored exactly as ours. The ladder: a block the layering job marks a photo or cutout stays a picture; otherwise Light first, and Medium too when Light needs more than two layers or fails, keeping whichever looks the same in fewer layers.

DeltaX shape blocks that look the same (shape, graphic and background blocks, 149):

| Kind                                   | Rule        | Light     | Medium     | **Ladder**                                     | Old worker |
| -------------------------------------- | ----------- | --------- | ---------- | ---------------------------------------------- | ---------- |
| shape (97)                             | v1 shared   | 55        | 88         | **88**                                         | 80         |
| shape (97)                             | v2 proposed | 43        | 89         | **89**                                         | 79         |
| graphic (35)                           | v1          | 14        | 32         | **33**                                         | 29         |
| graphic (35)                           | v2          | 16        | 32         | **33**                                         | 32         |
| background (17)                        | v1          | 12        | 13         | **14**                                         | 12         |
| background (17)                        | v2          | 11        | 12         | **13**                                         | 11         |
| **all 149**                            | **v1**      | 81 (54 %) | 133 (89 %) | **135 (91 %)**                                 | 121 (81 %) |
| **all 149**                            | **v2**      | 70 (47 %) | 133 (89 %) | **135 (91 %)**                                 | 122 (82 %) |
| development ads (32 ads, 102 blocks)   | v1 / v2     | 63 / 53   | 99 / 99    | **99 / 99**                                    | 89 / 86    |
| frozen ads (16 ads, 47 blocks)         | v1 / v2     | 18 / 17   | 34 / 34    | **36 / 36**                                    | 32 / 36    |
| photos and cutouts made shapes (of 72) | v1 / v2     | 0 / 0     | 4 / 3      | **0 / 0 with the job's kinds** (4 / 3 without) | not sent   |

The old worker's 141 in round 1 was by its own check; on the shared rule it is 121. The ladder leads on every kind under both rules, and ties the old worker on the frozen ads under v2 (36 each). The frozen ads are harder for both (77 % against 97 % on the development ads for the ladder; 77 % against 84 % for the old worker under v2).

Synthetic sets (blocks that should be shapes and look the same; pictures wrongly made shapes):

| Set                                                           | Rule | Light          | Medium         | **Ladder**         | Pictures made shapes | Ladder IoU mean (p10) | Ladder layers (truth 1.1) |
| ------------------------------------------------------------- | ---- | -------------- | -------------- | ------------------ | -------------------- | --------------------- | ------------------------- |
| held-out part of set 1 (208)                                  | v1   | 99/190 (52 %)  | 157/190 (83 %) | **162/190 (85 %)** | 0/18                 | 0.951 (0.834)         | 1.19                      |
| held-out part of set 1 (208)                                  | v2   | 108/190 (57 %) | 178/190 (94 %) | **182/190 (96 %)** | 0/18                 | 0.953 (0.833)         | 1.18                      |
| **set 2, new seed, never looked at before its one run (312)** | v1   | 158/286 (55 %) | 248/286 (87 %) | **249/286 (87 %)** | 0/26                 | 0.962 (0.875)         | 1.16                      |
| **set 2**                                                     | v2   | 158/286 (55 %) | 271/286 (95 %) | **273/286 (95 %)** | 0/26                 | 0.963 (0.894)         | 1.18                      |

Brand snaps on set 2: the ladder bound 89 of 90 kit-coloured layers to the right token, with 2 wrong bindings under v1 and none under v2.

Time and memory (one core, garbage collected between blocks; per ad = all its shape, graphic, background, photo and cutout blocks):

|                                                                            | Round 1                 | Round 2, no kinds       | Round 2, with the job's kinds |
| -------------------------------------------------------------------------- | ----------------------- | ----------------------- | ----------------------------- |
| Ladder, time per ad, median / p95 / slowest (v1)                           | 9.6 s / 45.4 s / 56.4 s | 4.9 s / 17.0 s / 21.6 s | **2.7 s / 9.0 s / 16.7 s**    |
| Ladder, time per ad (v2)                                                   |                         | 6.7 s / 20.8 s / 23.4 s | 3.6 s / 13.7 s / 19.1 s       |
| Medium, time per shape block median / p95 (v1)                             | 1.77 s / 11.8 s         | 0.72 s / 2.9 s          |                               |
| Peak working set, whole DeltaX run, Light / Medium (v1)                    | 410 / 464 MB            | 360 / 476 MB            |                               |
| Peak working set, Medium under v2                                          |                         | 514 MB                  |                               |
| Peak resident memory on the heaviest ad (two 1,000-px backgrounds), Medium | 290 MB                  | 275 MB                  |                               |

Looks-the-same is unchanged or better throughout: Medium kept every round-1 decision on DeltaX before the full-size tracing step was added, which then raised it from 130 to 133.

### What changed, all general methods

- **Fair comparison** (`src/score-old.ts`): the old answers' paths, fills, linear gradients (CSS angle, which reproduces its purple-to-blue backdrop), strokes, shadows (canvas `shadowBlur` is Dazbee's blur, both σ = blur / 2) and layer blurs mapped into Dazbee graphics, scaled from the ad's pixels to the block's (19 ads are stretched between the two). Where its format is unclear (whether a layer blur is a σ or a radius), both readings are drawn and the better one counts for the old worker.
- **Shape kinds by rotational symmetry with a count search**: a star's points and a polygon's sides start from the outline's strongest angular frequency, then neighbouring counts are tried, each at six turns across a point's period, and the best fit kept (`src/fit.ts`). Any regular burst, star or polygon; an irregular burst stays a path.
- **Editable shape over a traced path**: when a region is traced because no shape kind held it within IoU 0.965, its best fitted shape (IoU 0.95 or more) is put back in the path's place if the block still looks the same under both rules. Rule v2 must agree, because the shared rule passes a 17-point star for a 20-point burst.
- **Dashed strokes along any outline**: marks of one colour lying along the edge of their box are one stroke; the outline is the marks closed into a ring, or else their convex hull, fitted by the same shape fitter as any region (so a dashed ellipse or polygon works as a dashed rectangle does); the dash period is searched within 15 % of the one implied by the count, with the pattern's start.
- **Full-size tracing as the last step**: when the shape answer doesn't look the same, every region is split and traced again at full size (blocks up to 768 px), with gradients, the shadow and brand snaps. AI-drawn pills and buttons whose edge is a pixel or two off a perfect pill now pass as one path that follows the edge, where the clean pill shape didn't (this was most of the old worker's lead under v2).
- **Grain**: rule v2 blurs both pictures by 1 px before comparing, so a flat rebuild of a grainy block is judged by its shapes and colours (grain blocks on the held-out set: ladder 39 % under v1, 100 % under v2). Keeping the grain itself would be a tiled image fill at low opacity over the flat fill, which Dazbee can draw; it needs one shared grain picture uploaded as an asset, so it is proposed, not built.
- **Speed**: the dashed search runs only on marks that lie along their box's edge (not texture specks on backgrounds); the lost-part check runs at no more than 512 px on the long side; Medium's slowest blocks went from 22 s to under 6 s; photos and cutouts the job marks are not fitted at all.
- **Memory**: the ΔE memo holds one block's colours (it grew to a million pairs across a run); garbage is collected between blocks; full-size SSIM folds its product maps one at a time. The whole-run peak for Medium did not fall (476 MB against 464 MB), because the full-size tracing step and rule v2's full-size SSIM hold full-size buffers for the largest blocks. Breakdown (`src/memory.ts`, heaviest ad): Node 65 MB, modules 30 MB, CanvasKit 23 MB resident (its 128 MB wasm heap is reserved, mostly untouched), a 1,000-px block 16 MB as a float picture plus 60 to 100 MB of working buffers at its peak. The next cut, not made: keep pictures as 8-bit (a quarter of the float size) and fit large backgrounds at the fit size only.

### Outside benchmark: Crello's test split

[Crello](https://huggingface.co/datasets/cyberagent/crello) (CDLA-Permissive-2.0 plus VistaCreate's terms) was measured internally only. The dataset is not gated. Only the test split's four Parquet files were downloaded into the git-ignored `data/` folder; no Crello data, image or derived picture was committed, and the downloaded data was deleted after the measurement.

**Sample.** 800 elements from the 1,971 test templates, picked by a hash of the template id and element index (never by content):

- 400 shape elements (`SvgElement`), which should become shapes;
- 200 coloured backgrounds, which should become shapes;
- 200 image elements, which should stay pictures.

**How it was run.**

- Each element is its own pre-rendered PNG. It went through Light, Medium and the ladder, clean and with the synthetic set's all-at-once AI degradation, under the shared rule (v1) and rule v2.
- IoU is the drawn layers' alpha against the clean element's alpha. Palette ΔE is each layer colour's ΔE00 to the nearest colour in the element's palette (present for 380 of the 400 shape elements and all backgrounds).
- Nothing was tuned on Crello.
- The ladder here has no block kinds, so the image elements test the matcher's own photo guard.
- Runs shared the machine, so the times are indicative only.

| Input       | Rule | Element type                        | Light           | Medium          | Ladder          | Ladder IoU mean (p10) | Ladder palette ΔE | Ladder layers | Ladder time median / p95 |
| ----------- | ---- | ----------------------------------- | --------------- | --------------- | --------------- | --------------------- | ----------------- | ------------- | ------------------------ |
| clean       | v1   | shape element                       | 196/400 (49 %)  | 330/400 (83 %)  | 333/400 (83 %)  | 0.951 (0.845)         | 0.05              | 1.66          | 0.50 s / 4.3 s           |
| clean       | v1   | coloured background                 | 200/200 (100 %) | 200/200 (100 %) | 200/200 (100 %) | 1.000 (1.000)         | 0.01              | 1.00          | 0.54 s / 0.9 s           |
| clean       | v1   | image element (wrongly made shapes) | 7/200 (4 %)     | 18/200 (9 %)    | 19/200 (10 %)   | -                     | -                 | -             | 0.27 s / 7.2 s           |
| clean       | v2   | shape element                       | 180/400 (45 %)  | 332/400 (83 %)  | 335/400 (84 %)  | 0.949 (0.840)         | 0.06              | 1.71          | 0.72 s / 5.7 s           |
| clean       | v2   | coloured background                 | 200/200 (100 %) | 200/200 (100 %) | 200/200 (100 %) | 1.000 (1.000)         | 0.01              | 1.00          | 1.84 s / 5.2 s           |
| clean       | v2   | image element (wrongly made shapes) | 8/200 (4 %)     | 22/200 (11 %)   | 23/200 (12 %)   | -                     | -                 | -             | 0.24 s / 9.0 s           |
| AI-degraded | v1   | shape element                       | 160/400 (40 %)  | 243/400 (61 %)  | 247/400 (62 %)  | 0.914 (0.657)         | 0.45              | 1.45          | 0.51 s / 3.8 s           |
| AI-degraded | v1   | coloured background                 | 200/200 (100 %) | 200/200 (100 %) | 200/200 (100 %) | 1.000 (1.000)         | 0.37              | 1.00          | 0.51 s / 1.5 s           |
| AI-degraded | v1   | image element (wrongly made shapes) | 7/200 (4 %)     | 12/200 (6 %)    | 14/200 (7 %)    | -                     | -                 | -             | 0.27 s / 4.8 s           |
| AI-degraded | v2   | shape element                       | 179/400 (45 %)  | 305/400 (76 %)  | 308/400 (77 %)  | 0.901 (0.631)         | 0.46              | 1.52          | 0.63 s / 5.6 s           |
| AI-degraded | v2   | coloured background                 | 200/200 (100 %) | 200/200 (100 %) | 200/200 (100 %) | 1.000 (1.000)         | 0.37              | 1.00          | 1.86 s / 4.2 s           |
| AI-degraded | v2   | image element (wrongly made shapes) | 9/200 (5 %)     | 23/200 (12 %)   | 24/200 (12 %)   | -                     | -                 | -             | 0.18 s / 6.4 s           |

**What it shows.**

- **Real designers' shapes:** the ladder keeps 83 % of shape elements clean (84 % under v2) with IoU 0.95 and palette ΔE 0.05, and every coloured background in one layer. Light alone keeps 49 %; Medium carries the rest.
- **AI-degraded copies:** 62 % under the shared rule and 77 % under v2. Grain and resampling hurt v1 most, as on the synthetic sets.
- **Image elements made shapes:** 19 of 200 clean (v1). Looked at by eye, about 11 of Medium's 18 are flat panels, gradients, a blurred shadow or vector-like icons that shapes rightly hold. About 7 are real photos, mostly small products on large white backgrounds: a test tube, a paper crane, a lipstick, hands, a portrait, a stool, a watercolour.
- **Rule v2 does not help with photos:** it makes slightly more image elements shapes (22 against 18 for Medium; it catches 3 and passes 7 others), because the blur and the lost-part bar let smooth photos through. Neither rule alone keeps photos out; in production the Layering job's block kinds must (with them the ladder makes no photo shapes). For uploaded pictures without kinds, the matcher needs a better photo guard; on Crello it was wrong on about 3.5 % (7 of 200).

**Bug found and fixed (general).** A group of marks whose convex hull covered too few pixels gave the shape fitter no starting shape, and Medium crashed on 2 degraded elements. The fitter now returns the window's box at IoU 0 (a poor fit every caller already handles), and those runs were redone.

### The photo guard (round 3)

Crello showed that pictures uploaded without the Layering job's block kinds need the matcher's own photo guard. It is now built (`src/photo.ts`), general, and kept.

**What it measures.** How much of the block its own shape answer leaves unexplained, so a flat panel still becomes a shape and a small product on white stays a picture. Six measures of the block against its rebuild, at no more than 384 px:

1. shading lost (low-frequency luminance residual);
2. detail lost (gradient magnitude the rebuild lacks);
3. gradient-direction entropy;
4. colour count (4-bit);
5. the blurred colour residual;
6. the share of strongly graded pixels.

These are combined by a logistic model whose weights and bar are in `src/photo-guard.json`. A shapes answer scoring at or over the bar stays a picture. `PHOTO_GUARD=off` turns it off.

**Trained on development data only** (`src/train-photo.ts`):

- the 32 development DeltaX ads (photo and cutout blocks against shape, graphic and background blocks, by the ads' own kinds);
- the synthetic set's development third;
- 141 photos made from the same development ads' photo and cutout blocks (`src/photo-data.ts`): each product placed small on a white canvas and on a flat colour at seeded sizes and places, plus a crop;
- no openly licensed outside photos were needed.

The bar is the highest score among development shape answers that looked the same, so no development shape is lost. On development data it stops 45 of the 73 photo answers that had passed the rule. A bar at the 99th percentile would stop 60 but lose 4 of 308 development shapes, so it was not used.

**Old guard against new** (the ladder without block kinds; every set run once with the scores recorded, both guards read from the same runs; `src/guard-eval.ts`):

| Set                                               | Rule | Photos made shapes, old       | new       | Shapes kept as pictures, old       | new       | Shapes that look the same, old | new |
| ------------------------------------------------- | ---- | ----------------------------- | --------- | ---------------------------------- | --------- | ------------------------------ | --- |
| Set                                               | Rule | Photos made shapes, old guard | new guard | Shapes kept as pictures, old guard | new guard | Shapes that look the same, old | new |
| ---                                               | ---  | ---                           | ---       | ---                                | ---       | ---                            | --- |
| DeltaX development ads (32)                       | v1   | 4/47                          | 3/47      | 3/102                              | 3/102     | 99                             | 99  |
| DeltaX development ads (32)                       | v2   | 3/47                          | 2/47      | 3/102                              | 3/102     | 99                             | 99  |
| DeltaX frozen ads (16)                            | v1   | 0/25                          | 0/25      | 11/47                              | 12/47     | 36                             | 35  |
| DeltaX frozen ads (16)                            | v2   | 0/25                          | 0/25      | 11/47                              | 11/47     | 36                             | 36  |
| synthetic set 1, development third                | v1   | 0/8                           | 0/8       | 8/96                               | 8/96      | 88                             | 88  |
| synthetic set 1, development third                | v2   | 0/8                           | 0/8       | 1/96                               | 1/96      | 95                             | 95  |
| synthetic set 1, held-out part                    | v1   | 0/18                          | 0/18      | 28/190                             | 28/190    | 162                            | 162 |
| synthetic set 1, held-out part                    | v2   | 0/18                          | 0/18      | 8/190                              | 8/190     | 182                            | 182 |
| synthetic set 2 (unseen)                          | v1   | 0/26                          | 0/26      | 37/286                             | 37/286    | 249                            | 249 |
| synthetic set 2 (unseen)                          | v2   | 0/26                          | 0/26      | 13/286                             | 13/286    | 273                            | 273 |
| Crello sample, clean (image elements as pictures) | v1   | 19/200                        | 15/200    | 67/600                             | 67/600    | 533                            | 533 |
| Crello sample, clean (image elements as pictures) | v2   | 23/200                        | 19/200    | 65/600                             | 65/600    | 535                            | 535 |

**What the guard stops on Crello.** Looked at by eye under the shared rule, the 4 image elements it stops are all real photos (a test tube, a paper crane, a lipstick, hands).

- Of the 15 image elements still made shapes, about 11 are flat panels, gradients, a blurred shadow or vector icons that shapes rightly hold.
- About 4 are photo-like: a portrait, a stool, and two faint textures.
- So real-photo mistakes on Crello fall from about 8 to about 4.

**Cost.** No shape lost on Crello, on either synthetic set, or on the development ads. On the frozen DeltaX ads, none under rule v2; one block under the shared rule (36 → 35 look the same). That is the one place it costs anything. Kept, since the recommended rule is v2.

**Still open:** the remaining photo-like answers (a portrait on white, a stool, faint textures) score under the bar. More varied photo training data (openly licensed product photos, with licences noted) would be the next step. With the job's block kinds, photos never reach the matcher.

### Rule v2, proposed to both halves

- **What it is.** The shared rule with three changes (`scoreV2` in `src/score.ts`):
  1. Both pictures are blurred by a 1-pixel Gaussian before comparing, so grain and sub-pixel edge shifts fade while real differences stay.
  2. SSIM is taken at the block's own size, with no downsampling.
  3. No more than 1 % of the block's pixels may differ by a blurred ΔE00 over 20.
- **Agreement with the 20 blind-judged blocks:** the shared rule alone 13 of 20; rule v2 alone 14 of 20; the ladder's decision 15 of 20 under the shared rule and 17 of 20 under v2.
  - The 17 counts my second look at the coupon. Its full-size traced rebuild changed after round 1 and now looks the same to me; that look was not blind.
  - The bars (σ 1, ΔE 20, 1 %) were read from those 20 blocks, rounded.
- **What it changes:**
  - It no longer fails grain.
  - It judges big blocks at the size they are shown. This let one soft DeltaX photo pass the shared rule and not v2, but on Crello v2 lets slightly more smooth product photos through (above), so it is no photo guard.
  - It catches a lost thin rim and misshapen dashes, which a whole-block mean hides.
- **What it still misses:**
  - Faint texture that the eye sees but that is under 20 ΔE (a gold badge's grain).
  - A very faint large circle on a gradient backdrop.

### Held out, and generic

- **Frozen ads.** 16 DeltaX ads (every third in name order) were frozen at the start of round 2 and no change was checked on them; they were seen in round 1, including some of the judged blocks.
- **Unseen synthetic set.** Synthetic set 2 (new seed, 312 blocks) was generated at the start of round 2 and opened only for its one final run. It is the truly unseen set; there the ladder keeps 87 % (v1) and 95 % (v2), and no picture became shapes.
- **No case-specific thresholds.** No code names a shape, an ad or a test case. The values kept from round 1 were set on sets (the synthetic development part, the 20 judged blocks), never on a single case. The one round-1 fallback that assumed a rectangular frame (the marks' box) was replaced by the general convex-hull fit.

### Determinism

A repeat run of all 91 blocks of the frozen ads gave identical answers. One development block (a dashed coupon) came back a picture instead of shapes in 4 of about 14 single runs made while the machine was heavily loaded by other work. Nothing in the pipeline reads time or randomness, and the renderer drew the same pixels on repeated calls. The cause was not found, and production needs a same-input-same-answer check before shipping.

### Recommendation (round 2)

**Build the ladder, judged by rule v2, with the layering job's block kinds.**

- **Most accurate on the same rule.** On DeltaX it keeps 135 of 149 shape blocks against the old worker's 122 (v2) or 121 (shared rule).
- **Same on unseen data.** It keeps 95 % of the unseen synthetic set (v2), with no picture made shapes.
- **One CPU.** It answers an ad in 2.7 s median, 9 s at the 95th percentile and 17 s at worst (shared rule; 3.6 / 13.7 / 19.1 s under v2), against the old worker's 23.8 s / 231 s / 607 s.
- **Memory.** Under 0.52 GB against its 1.1 GB.
- **Rule v2 for the text half.** It removes the shared rule's grain blind spot and adds the lost-part check; on Crello it keeps 84 % of shape elements clean and 77 % degraded (shared rule 83 % and 62 %). It is not a photo guard: photos are kept out by the job's block kinds.

Dazbee's words are used throughout (`GLOSSARY.md`): a block becomes **graphics** (layers made of a **shape** plus fills, strokes and effects), or stays a **picture** (a graphic with an image fill).

## Round 1 headline

Every number is measured, each process pinned to one CPU core, every answer drawn by Dazbee's renderer. **Ladder** = Light first, and Medium too when Light's answer needs more than two layers or doesn't look the same; the block takes whichever looks the same in fewer layers.

|                                                                                      | Light                                                                             | Medium                  | **Ladder (recommended)** | Old worker                                                          |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- | ----------------------- | ------------------------ | ------------------------------------------------------------------- |
| DeltaX shape blocks made shapes that look the same (149: shape, graphic, background) | 81 (54 %)                                                                         | 130 (87 %)              | **132 (89 %)**           | 141 (95 %), by its own check, not the shared rule                   |
| DeltaX photos and cutouts wrongly made shapes (of 72)                                | 0                                                                                 | 3                       | 3                        | not sent to it (its `convert` list)                                 |
| Synthetic held-out: should be shapes and look the same (of 190)                      | 99 (52 %)                                                                         | 150 (79 %)              | **158 (83 %)**           | not run                                                             |
| Synthetic held-out: pictures wrongly made shapes (of 18)                             | 0                                                                                 | 0                       | 0                        | not run                                                             |
| Synthetic: IoU of each true shape with its layer, mean (10th percentile)             | 0.938 (0.793)                                                                     | 0.955 (0.823)           | 0.947 (0.805)            | not run                                                             |
| Layers per block made shapes: synthetic (truth 1.1) / DeltaX                         | 1.42 / 1.40                                                                       | 1.13 / 1.58             | 1.21 / 1.61              | 1.49 on the 126 blocks both it and Medium make shapes (Medium 1.52) |
| Mean SSIM / ΔE of DeltaX blocks made shapes                                          | 0.963 / 1.30                                                                      | 0.957 / 1.42            | 0.955 / 1.50             | not measured                                                        |
| Fill colour ΔE to the true colour, synthetic                                         | 0.18                                                                              | 0.13                    | between                  | not run                                                             |
| Brand snaps right of wanted / wrong bindings, synthetic                              | 58 of 60 / 5                                                                      | 59 of 60 / 1            | 59 of 60 / 3             | none                                                                |
| Same shapes-or-picture answer as the old worker (of 149)                             | 89                                                                                | 130                     | 132                      |                                                                     |
| Time per DeltaX block, median / 95th percentile                                      | 0.22 s / 1.05 s                                                                   | 1.77 s / 11.8 s         | 0.80 s / 9.4 s           | not split by block                                                  |
| Time per ad (its shape blocks), median / 95th percentile / slowest                   | 0.77 s / 2.8 s / 3.5 s                                                            | 7.6 s / 30.1 s / 52.8 s | 5.6 s / 30.9 s / 54.4 s  | 23.8 s / 231 s / 607 s                                              |
| Time per synthetic block, median / 95th percentile                                   | 0.31 s / 2.0 s                                                                    | 1.01 s / 4.3 s          | 0.68 s / 5.8 s           | not run                                                             |
| Peak memory, whole process, DeltaX run                                               | 410 MB                                                                            | 464 MB                  | 464 MB at most           | 1.1 GB (its processes, summed)                                      |
| Cold start to the first block answered                                               | 5.3 to 5.7 s: CanvasKit 0.2 s, the rest Node compiling the prototype's TypeScript | same                    | same                     | 10 to 30 s by its README (not re-measured)                          |
| Needs                                                                                | Node and Dazbee's renderer                                                        | same                    | same                     | Python, Chrome, Fabric, 7 GB of font data                           |

Sources: `out/deltax-*.jsonl`, `out/synth-*-test.jsonl`, `out/timed-summary.txt`, `src/compare.ts`, `src/ladder.ts`; the old worker's numbers from its own shapes regression on one core (`out/old-worker/`), which matched its committed baseline to the byte. The ladder's numbers are put together from the Light and Medium runs block by block (`src/ladder.ts`), not from a run of its own.

## Round 1 recommendation

**Build the ladder**: one package with Light's and Medium's steps, Light run first, Medium run when Light's answer needs more than two layers or doesn't look the same, every answer judged by Dazbee's renderer with Medium's finer decision.

- **It is the most accurate of the three.** 89 % of DeltaX shape blocks and 83 % of the held-out synthetic blocks come back as shapes that look the same, above Medium alone (87 %, 79 %): Light's plainer answer sometimes looks the same where Medium's richer one doesn't (overlapping shapes 8 of 8 against 6 of 8). No synthetic picture became shapes; on DeltaX 3 of 72 photos and cutouts did (risks).
- **Light alone falls short, and only in reach.** On every kind it can draw, Light matched Medium block for block on the held-out set (rectangles, rounded rectangles, pills, circles, ellipses, lines, rings, outlines, rotated and see-through panels: the same counts). The gap, 52 % against 79 %, is stars, polygons, icons, shadows, gradients and dashes, which Light cannot draw. Light is not worse at what it does; it does less.
- **It runs on one CPU.** Per ad: median 5.6 s, 95th percentile 31 s, slowest 54 s on one core, against the old worker's 23.8 s, 231 s and 607 s; 0.46 GB against 1.1 GB; no Chrome, Python or font data. Nearly half the DeltaX shape blocks (72 of 149) finish in Light alone, at a median 0.18 s.
- **Medium for everything costs twice the time for less.** Medium alone takes a median 1.77 s a block against the ladder's 0.80 s, and keeps 2 fewer DeltaX blocks and 8 fewer synthetic blocks as shapes.
- **Keep Medium's finer decision**: it agreed with blind hand-judgement on 15 of 20 blocks against 13 of 20 for the shared rule alone. Raise with the text half whether the SSIM bar should allow AI grain (risks).

## Decisions taken while the owner was away

Each is "Decision (Claude, 2026-11-21)".

1. **Light keeps the owner's list exactly**: rectangles (corner radius, so pills too), ellipses and circles, lines, as fills or outline strokes, flat colours. Stars and polygons went into Medium with paths, gradients and shadows. Light was not made stronger behind the owner's back; its gap is measured instead.
2. **"Looks the same" is the shared rule as written**: SSIM ≥ 0.90 on luminance and mean ΔE00 ≤ 5 **over every pixel of the block**. A block is see-through, so both pictures are drawn over white and over black and the worse of the two counts. The stricter reading I tried first (mean ΔE over only the pixels the block covers) agreed with blind hand-judgement on 9 of 20 blocks against 13 of 20 for the rule as written, so it was dropped; it is still recorded as `deltaEContent`.
3. **SSIM follows Wang et al.'s reference**: 11×11 Gaussian window, σ 1.5, K1 0.01, K2 0.03, after downsampling by round(min(w, h) / 256).
4. **ΔE is computed on 8-bit colours** (PNG and render values, composites rounded) and memoised by colour pair: the same answer, many times faster on flat blocks.
5. **Medium's finer decision** adds one check to the rule: no part of the block (a colour region of 0.5 % of the block or more) may be lost. A part is lost when its mean ΔE00, after both pictures are blurred by a 1-pixel Gaussian, is over 12. The blur makes sub-pixel edge shifts agree and keeps missing or misshapen parts. The 12 was set on the hand-judged examples below; it is the one value tuned on them.
6. **Brand snap at ΔE00 ≤ 5**, then drawn and checked: if snapping makes a block look different that looked the same before, the farthest snaps are undone. Set on the synthetic development part: every wanted snap was right from 3 to 10, and near-miss colours (7 to 12 ΔE from a kit colour) began to snap wrongly at 8. Five is the largest value under that with a margin, and a snap within 5 can never by itself break the ΔE-5 rule. Stroke colours snap too, but are not bound: Dazbee's `BINDABLE_PROPERTIES` has no stroke colour.
7. **Fit resolution 256 px on the long side** for both versions; every decision is drawn and scored at the block's full size.
8. **Layer limits**: Light 8, Medium 16 layers a block; more is kept a picture ("too many parts to edit").
9. **The old worker was run as a black box only**: its README and `shapes_baseline.json` were read, its source was not. Its shapes regression ran on one core (`SHAPE_WORKERS=1 SEARCH_WORKERS=1`, process affinity one core) and reproduced its baseline to the byte.
10. **Hand-judging was blind**: 20 DeltaX blocks, each shown as block | Medium rebuilt with no numbers, judged "looks the same" or not, and only then compared with the scores.
11. **Synthetic split**: 312 blocks, every id divisible by 3 (104) for development, the other 208 held out; every synthetic number below is the held-out part.
12. **DeltaX "shape blocks"** are the blocks of kind shape, graphic and background (149, the old worker's `convert` list). Photo and cutout blocks (72) are run too, as blocks that must stay pictures. Logos (50) are reported apart: they are lettering and belong to the text half.

## What the research says

Links were checked one by one in this session (DOI lookups or the page itself).

- **Tracing.** Potrace ([paper](https://potrace.sourceforge.net/potrace.pdf), [site](https://potrace.sourceforge.net/)) fits an optimal polygon to a two-colour bitmap, then smooths it into Béziers; excellent outlines, but no colour, gradients or shapes, and GPL-licensed, so read, never copied. VTracer ([repo](https://github.com/visioncortex/vtracer), [write-up](https://www.visioncortex.org/vtracer-docs), MIT) traces colour images by hierarchical clustering, in stacked or cut-out mode; paths with flat fills only.
- **Differentiable and learned vectorisation.** DiffVG ([paper](https://doi.org/10.1145/3414685.3417871)) makes rasterising differentiable; LIVE ([arXiv](https://arxiv.org/abs/2206.04655)) adds paths layer by layer where the error is largest; segmentation-guided layered vectorisation with radial gradients ([arXiv 2408.15741](https://arxiv.org/abs/2408.15741)), semantic simplification ([arXiv 2406.05404](https://arxiv.org/abs/2406.05404)), SAMVG ([arXiv 2311.05276](https://arxiv.org/abs/2311.05276)), StarVector ([arXiv 2312.11556](https://arxiv.org/abs/2312.11556)) and OmniSVG ([arXiv 2504.06263](https://arxiv.org/abs/2504.06263)). All need a GPU, PyTorch or model weights. What carries over: render-and-compare, adding layers where the error is, coarse to fine.
- **Fitting shapes.** RANSAC ([Fischler & Bolles 1981](https://doi.org/10.1145/358669.358692)), direct least-squares ellipses ([Fitzgibbon et al. 1999](https://doi.org/10.1109/34.765658)), circle fits ([Kåsa 1976](https://doi.org/10.1109/TIM.1976.6312298), [Taubin 1991](https://doi.org/10.1109/34.103273)), Douglas–Peucker ([1973](https://doi.org/10.3138/FM57-6770-U75U-7727)), Schneider's least-squares Bézier fitting (Graphics Gems 1990, [FitCurves.c](https://github.com/erich666/GraphicsGems/blob/master/gems/FitCurves.c)), and Fogleman's [primitive](https://github.com/fogleman/primitive) (hill-climbing shapes by render-and-compare).
- **Colour.** Median cut ([Heckbert 1982](https://doi.org/10.1145/965145.801294)), Wu's quantiser ([Graphics Gems II](https://doi.org/10.1016/b978-0-08-050754-5.50035-9)), k-means as a quantiser ([Celebi 2011](https://arxiv.org/abs/1101.0395)), CIEDE2000 ([Sharma, Wu, Dalal 2005](https://doi.org/10.1002/col.20070), [test data](https://hajim.rochester.edu/ece/sites/gsharma/ciede2000/)), SSIM ([Wang et al. 2004](https://doi.org/10.1109/TIP.2003.819861)).
- **Gradients.** Optimised gradient meshes ([Sun et al. 2007](https://doi.org/10.1145/1276377.1276391)) and diffusion curves ([Orzan et al. 2008](https://doi.org/10.1145/1360612.1360691)) model colour as a smooth function of position; for SVG-style fills, least squares of colour on position gives a linear gradient's axis.
- **Shadows.** A drop shadow is "a blurred, offset version of the input image's alpha mask drawn in a particular color, composited below the image" ([Filter Effects](https://www.w3.org/TR/filter-effects-1/#funcdef-filter-drop-shadow)); so it is a search over offset, blur and opacity.
- **Design tools.** Illustrator's Image Trace ([options](https://helpx.adobe.com/illustrator/desktop/manage-objects/traces-mockups-symbols/image-trace-panel-options.html)) makes live circles and rectangles only when they are isolated and perfect, and only linear gradients. Figma's Vectorize ([help](https://help.figma.com/hc/en-us/articles/38031452710807)) is an AI action for lettering and illustrations, no shapes or gradients. [Vectorizer.AI](https://vectorizer.ai/) claims fitted circles, ellipses, rounded rectangles and stars (vendor claims). Recraft ([docs](https://www.recraft.ai/docs/recraft-studio/format-conversions-and-scaling/vectorizing)), Kittl ([help](https://help.kittl.com/ai-tools/ai-vectorizer)) and Canva ([help](https://www.canva.com/en_au/help/convert-images-to-vectors/)) trace to paths with a colour count.

### 2026 methods, checked in round 2

Read on 2026-11-21 from each paper's own page; none was run.

- **LayerD** (Suzuki et al., ICCV 2025: [paper](https://openaccess.thecvf.com/content/ICCV2025/html/Suzuki_LayerD_Decomposing_Raster_Graphic_Designs_into_Layers_ICCV_2025_paper.html), [arXiv 2509.25134](https://arxiv.org/abs/2509.25134), [project](https://cyberagentailab.github.io/LayerD)).
  - **What it does:** peels a flat design into layers by repeated top-layer matting (a BiRefNet-style model) and background completion (LaMa), then recovers each layer's colours by inverting the alpha blend.
  - **Flat-colour refinement:** where the surroundings are nearly gradient-free, it snaps pixels to a small palette taken from percentiles in Lab (at most 2 colours for backgrounds, 10 for foregrounds) and recomputes soft edges.
  - **Metric:** layers aligned by dynamic time warping, with up to 5 greedy merges of adjacent layers allowed, each pair scored by alpha soft IoU plus RGB L1.
  - **Output:** RGBA raster layers; the authors name vectorisation as future work, with their layers as its input.
  - **For us:** it would replace the GPU separation step upstream, not this one. Its palette snap is what our colour split already does (k-means in Lab, colours under ΔE 7 merged). Its metric could score the whole Layering job.
- **CreatiParser** (Chen et al., [arXiv 2604.19632](https://arxiv.org/abs/2604.19632), 2026).
  - **What it does:** a vision-language model reads text into a re-editable text protocol, and a multi-branch RGBA diffusion model generates the background and sticker layers. It is aligned to human preference with a reward model and GRPO.
  - **Evaluated on:** Parser-40K and Crello.
  - **Output:** raster layers from diffusion, on a GPU.
  - **For us:** a separation step, not a vectoriser.
- **Synthetic layered design data** (Wu et al., [arXiv 2605.15167](https://arxiv.org/abs/2605.15167), 2026, SynLayers).
  - **Finding:** purely synthetic layered designs beat a real dataset (PrismLayersPro) for training a decomposition model, with gains levelling off near 50 K samples. Synthetic data also keeps the layer-count distribution balanced.
  - **For us:** it supports this prototype's use of a generated set with exact truth for tuning. Ours is for measuring and setting thresholds, not training, so a few hundred blocks suffice.
- **LaDe** (Lungu-Stan et al., Adobe, CVPR 2026 workshop: [arXiv 2603.17965](https://arxiv.org/abs/2603.17965)).
  - **What it does:** one latent diffusion model for text-to-image, text-to-layers and design decomposition. A vision-language model describes the layers, and only the layers are denoised.
  - **Evaluated on:** Crello's test set, judged by vision-language models.
  - **Output:** raster, on a GPU.
- **Graphic-Design-Bench** (Deganutti et al., [arXiv 2604.04192](https://arxiv.org/abs/2604.04192), 2026).
  - **What it is:** 50 understanding and generation tasks over layout, typography, infographics, templates and animation, built on the LICA layered-composition data.
  - **Metrics:** spatial, perceptual, text, semantic and structural.
  - **For us:** the abstract mentions producing valid vector graphics, but names no task that turns a raster element into vector shapes. Whether one fits can't be confirmed without the full paper.

**Does anything here beat this prototype on accuracy with general methods?** Not for this step under the brief's limits (one CPU, no model). The 2026 work all decomposes into raster layers with GPU models; the vectorising of each layer that Dazbee needs comes after it. The one transferable idea, LayerD's palette snap for near-flat regions, is already how our colour split works.

**Which public benchmark could score the shape matcher: Crello** ([dataset card](https://huggingface.co/datasets/cyberagent/crello/blob/main/README.md), the data LayerD, CreatiParser and LaDe evaluate on).

- **What it holds:** every element of about 23,000 real templates, with its type (`SvgElement`, `ColoredBackground`, `ImageElement`, `SvgMaskElement`, `TextElement`), its box and angle, a pre-rendered PNG of the element alone, and the vector element's colour palette where the source has one.
- **How it would score us:**
  - Feed each `SvgElement` and `ColoredBackground` PNG (real designers' shapes, rendered clean) through the ladder and score it with the same rule.
  - Use its alpha as the geometry truth (IoU) and its palette as the colour truth.
  - Use `ImageElement` PNGs as must-stay-picture blocks.
  - Add the same AI degradations as the synthetic set to approach AI ads.
- **What it can't give:** exact shape kinds or path data (the card ships only the PNGs and palettes), so "how many layers a designer would pick" is not in it.
- **Licence:** CDLA-Permissive-2.0, plus agreeing to VistaCreate's licence terms; the distributor does not own the templates. Fine for measuring internally; check the terms before keeping any of it.
- **Recommended:** run Crello's test split (1,971 templates) as the next measurement, before production.
- **The whole Layering job:** LayerD's merge-tolerant layer metric on Crello would score it end to end.

**What was used**, all written fresh in TypeScript, no library added: k-means in CIELAB with seeded k-means++ starts and ΔE merging (Celebi; not Wu); moments for the centre and angle, the area formula for a rounded rectangle's radius (area = wh − (4 − π)r²), the angular profile's strongest frequency for star points and polygon sides, then coordinate-descent refinement by render-and-compare (primitive's idea, without randomness); marching squares at half coverage and least-squares cubic Béziers with Newton re-parameterisation and splitting (Schneider's method, re-derived, not copied); least-squares linear gradients and a searched radial centre; drop shadows by search; layers stacked largest first, as in VTracer's stacked mode. PNG decoding and encoding go through Dazbee's own CanvasKit build, so the pictures are read from bytes we control.

## Design

Both versions run the same pipeline; Medium switches more steps on.

| Step         | Light                                                                                                                                                                                                                                                              | Medium                                                                                                                                         |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Colour split | k-means (k ≤ 10) in CIELAB, clusters under ΔE 7 merged, 3×3 majority, specks folded, connected regions. Soft coverage per region: alpha, and at a border the pixel's share between the two colours; faint edge pixels of the same colour within 3 px join          | same                                                                                                                                           |
| Stacking     | regions back to front by filled outline; holes covered by other colours are filled (the shape runs under), see-through holes stay holes; a shape may reach under the layers drawn over it at no cost (a rectangle half hidden by a circle stays a whole rectangle) | same                                                                                                                                           |
| Shape kinds  | rectangle (radius, so pill and square), ellipse (circle), line                                                                                                                                                                                                     | + polygon, star (points, inner radius, corner radius)                                                                                          |
| Outlines     | a region with a see-through hole, or a thin ring round other colours, is an outline: the shape's outer edge with a stroke inside                                                                                                                                   | + dashed outlines: marks of one colour round a ring become one stroke with dash, gap and offset fitted                                         |
| Free shapes  | none                                                                                                                                                                                                                                                               | a region no shape kind holds (IoU under 0.965) is traced: smooth Bézier path, holes by evenodd; many small marks of one colour become one path |
| Fills        | flat colour, paint opacity for see-through panels                                                                                                                                                                                                                  | + linear or radial gradient (2 or 3 stops) where it lowers the region's ΔE by 0.75; bands of one gradient merged into one region first         |
| Effects      | none                                                                                                                                                                                                                                                               | drop shadow fitted where a soft dark fringe is left uncovered                                                                                  |
| Cleanup      | layers that change nothing are dropped                                                                                                                                                                                                                             | same                                                                                                                                           |
| Brand        | fills within ΔE 5 of a kit colour take it, bound `fill: brand:<token>`; checked by drawing                                                                                                                                                                         | same                                                                                                                                           |
| Decision     | drawn by Dazbee's renderer at full size; shapes when it looks the same, else picture                                                                                                                                                                               | same, plus: no part lost (decision 5), and when it fails, one more try as traced paths only                                                    |
| Refining     | 40 renders for the leading shape kind, 10 for the next two                                                                                                                                                                                                         | 80 and 20                                                                                                                                      |

Code: `src/regions.ts` (split), `src/fit.ts` (shape fitting), `src/trace.ts` (paths), `src/gradient.ts`, `src/match.ts` (the two pipelines, shadows, dashes, brand, decision), `src/score.ts` (the shared rule), `src/draw.ts` (layers to a design, drawn by `@dazbee/renderer`).

## What Dazbee does better

- **Judged by Dazbee's own renderer.** Every candidate shape and every decision is drawn by the same CanvasKit build that draws the editor and exports (ADR-0005). The old worker draws its check with Fabric in Chrome, an editor Dazbee doesn't use; here "looks the same" means the same in the product.
- **Real shapes, not only paths.** A badge is an ellipse, a button a rectangle with its radius, a burst a star with its points: a designer resizes it and the corners stay round, or changes the points or the radius in the panel. The old worker answers paths only (its README), and design tools make live shapes only from perfect, isolated ones.
- **Shapes that run under others.** A rectangle half covered by a circle comes back as a whole rectangle under the circle, and a ring round a coloured centre comes back as an outline over a disc, so moving one doesn't leave a hole.
- **Outlines are strokes.** Rings, frames and outline buttons become a shape with a stroke, so the stroke width is one number; dashed frames become one dashed stroke instead of dozens of dashes (on clean blocks; see risks).
- **Brand-bound.** A fill near a kit colour is bound to the brand token (ADR-0018 bindings), so changing the brand colour recolours the vectorised ad. The snap is checked by drawing.
- **Effects and gradients as Dazbee stores them.** Drop shadows are Dazbee `dropShadow` effects; gradients are Dazbee linear and radial paints, so they stay editable in the paint picker.
- **One CPU, no browser, no Python, no font data.** It runs in Node beside the API's own renderer.

## Results

### DeltaX test ads: all 48 ads, 271 non-text blocks

| Block kind                            | Light: made shapes | Medium: made shapes | Light time median / p95 | Medium time median / p95 |
| ------------------------------------- | ------------------ | ------------------- | ----------------------- | ------------------------ |
| shape (97)                            | 55                 | 85                  | 0.23 s / 0.87 s         | 1.44 s / 7.2 s           |
| graphic (35)                          | 14                 | 32                  | 0.08 s / 0.84 s         | 1.47 s / 7.0 s           |
| background (17)                       | 12                 | 13                  | 0.70 s / 2.0 s          | 7.7 s / 24.9 s           |
| photo (31), should stay pictures      | 0                  | 1                   | 0.26 s / 0.66 s         | 0.38 s / 14.5 s          |
| cutout (41), should stay pictures     | 0                  | 2                   | 0.12 s / 1.05 s         | 0.17 s / 13.9 s          |
| logo (50), lettering: the text half's | 0                  | 18                  | 0.27 s / 1.0 s          | 3.1 s / 7.4 s            |

- **Why Medium keeps 19 shape blocks as pictures**: looks different 13 (tilted textured paper cards, gold-textured badges, pills with a faint rim or grain: SSIM 0.80 to 0.89; the old worker made shapes of most of these), a part would be lost 4 (a thin dark rim, uneven dashes), too detailed 1 (a painted lantern-festival backdrop), too many layers 1 (a concert-light backdrop).
- **Why Light keeps 68 as pictures**: it can't draw what they hold (stars and bursts, icons, shadows, gradients, dashed rings), or they hold more than 8 parts.
- **Photos and cutouts Medium made shapes**: a soft pastel full-canvas still life (5 layers; it passes SSIM 0.904 because SSIM is computed 4× downsampled on a 1024-pixel block), a flat black crowd silhouette (2 paths; arguably right), and a cut-out of a child.
- **Against the old worker**: it made 141 of 149 shapes; the ladder gives the same answer on 132. Where both make shapes, they use about as many layers (1.49 against Medium's 1.52), but its layers are all paths and ours are rectangles, ellipses, stars and outlines where they fit.

### Synthetic held-out set: 208 blocks with exact ground truth

Made shapes that look the same, of the blocks that should be shapes, by kind (Light | Medium):

| Kind                                   | Light         | Medium        |     | Kind                                          | Light | Medium |
| -------------------------------------- | ------------- | ------------- | --- | --------------------------------------------- | ----- | ------ |
| rectangle                              | 6/8           | 6/8           |     | badge (disc + inner ring)                     | 3/9   | 4/9    |
| rounded rectangle                      | 7/9           | 7/9           |     | button with drop shadow                       | 2/8   | 8/8    |
| pill                                   | 7/9           | 7/9           |     | ribbon (notched path)                         | 1/9   | 6/9    |
| circle                                 | 7/8           | 7/8           |     | icon (heart, arrow, check, bubble, ring path) | 1/9   | 9/9    |
| ellipse                                | 7/9           | 7/9           |     | linear gradient                               | 2/8   | 4/8    |
| line                                   | 5/9           | 5/9           |     | radial gradient                               | 2/9   | 5/9    |
| star                                   | 0/8           | 8/8           |     | gradient backdrop                             | 8/9   | 7/9    |
| starburst                              | 0/9           | 9/9           |     | overlapping shapes                            | 8/8   | 6/8    |
| polygon                                | 1/9           | 9/9           |     | rotated                                       | 8/9   | 9/9    |
| ring                                   | 8/8           | 8/8           |     | see-through panel                             | 7/9   | 7/9    |
| outline                                | 9/9           | 9/9           |     | dashed frame                                  | 0/8   | 4/8    |
| photo-like (9) and detailed render (9) | 0 made shapes | 0 made shapes |     |                                               |       |        |

By degradation (looks the same; IoU of the shapes kept):

| Degradation            | Light        | Medium       |
| ---------------------- | ------------ | ------------ |
| clean                  | 70 % (0.976) | 93 % (0.965) |
| resampled              | 61 % (0.960) | 93 % (0.950) |
| JPEG                   | 63 % (0.920) | 81 % (0.979) |
| blurred                | 48 % (0.916) | 89 % (0.955) |
| wobbly edges           | 56 % (0.948) | 89 % (0.945) |
| all at once (AI-like)  | 54 % (0.907) | 81 % (0.941) |
| grain (noise σ 3 to 6) | 14 % (0.879) | 32 % (0.933) |

- **Grain fails the rule on its own.** A flat rebuild of a block with grain of σ 5 levels gets an SSIM contrast term of about C2 / (σ² + C2) = 0.70 in every flat window, so the shapes can be exactly right (IoU 0.93) and still "look different". AI pictures carry such grain.
- **Brand**: of the 60 layers whose true colour was a kit colour, Light bound 58 and Medium 59 to the right token; no block whose colours were near a kit colour (7 to 12 ΔE) was snapped by either. Light's 5 wrong bindings are all bands of a gradient whose flat colour sat near a kit colour; Medium draws those as one gradient instead. Looks-the-same by brand group, Light | Medium: brand 49 % | 81 %, near-miss 57 % | 75 %, none 53 % | 81 %.
- **Geometry**: where kept as shapes, each true shape's IoU with its layer averaged 0.938 (Light) and 0.955 (Medium). The lowest are thin things, where one pixel is a large share: lines (Light 0.77, Medium 0.79) and outlines (0.78, 0.80, while all 9 look the same).

## The rule against 20 hand-judged examples

Twenty DeltaX blocks, picked to cover passes, fails and blocks near the line (line icons, ornaments, thin outlines, pills, textured badges, a coupon, gradient backdrops, a speech bubble, a star). Each was judged blind from block | Medium rebuilt.

| How the decision is made                                                 | Agrees with the hand judgement |
| ------------------------------------------------------------------------ | ------------------------------ |
| Shared rule, ΔE over the block's covered pixels only                     | 9 / 20                         |
| **Shared rule as written (ΔE over the whole block)**                     | **13 / 20**                    |
| Shared rule, SSIM bar lowered to 0.87                                    | 14 / 20                        |
| Shared rule, SSIM bar lowered to 0.85                                    | 15 / 20                        |
| **Medium's decision: shared rule + no part lost (blurred part ΔE ≤ 12)** | **15 / 20**                    |

Where the rule and the eye differ:

- **Rule says different, eye says same (3):** smooth pills with a faint AI texture or rim (pizza_napoli block 6, morrowmere block 7, fresh_wine_vinea block 8), SSIM 0.85 to 0.89. SSIM reads the texture's loss as structure lost.
- **Rule says same, eye says different (4):** a thin dark rim the layers dropped (lipstick_rouge block 7), dashes drawn as blobs (food_delivery block 7), a faint outline drawn wrongly (loomhaven block 7), and a very faint large circle missing from a gradient backdrop (fintech_coinly block 11). Mean ΔE over the whole block hides a small lost part. Medium's part check catches the first two.
- The covered-pixels reading fails line icons the eye accepts (roamwick's airplane, realestate's bed, diwali's ornament): their pixels are mostly anti-aliased edge, where a fraction of a pixel's shift is a large ΔE.

For the text half (same rule): thin lettering has the same edge effect. Averaging ΔE over the whole block is the reading that agreed with the eye; a lost-part check like Medium's catches what the average hides.

## Examples

Fifteen sheets, block | Light rebuilt | Medium rebuilt, each captioned with its answer, layer count, SSIM and ΔE, in `prototypes/shape-match/out/examples/` (git-ignored; remade with `node src/examples.ts`):

| Sheet | Block                                              | Light                        | Medium                                                        |
| ----- | -------------------------------------------------- | ---------------------------- | ------------------------------------------------------------- |
| 01    | bakery_crumb 6, mustard badge with a soft shadow   | picture (no shadow)          | 1 circle with its drop shadow                                 |
| 02    | grocery_weekly 8, jagged red burst                 | picture                      | 1 path (the burst is irregular, so traced rather than a star) |
| 03    | toys_bloom 9, rounded yellow star                  | picture                      | 1 path                                                        |
| 04    | fresh_kids_brightminds 9, speech bubble            | picture                      | 2 layers                                                      |
| 05    | roamwick 14, outline airplane icon                 | picture                      | 1 path with its holes                                         |
| 06    | fresh_diwali_mithaas 6, gold leaf-and-dot ornament | picture                      | 7 layers (ovals and paths)                                    |
| 07    | food_delivery 7, coupon with a dashed frame        | picture (40 parts)           | picture: the dashes come back as blobs, caught as a lost part |
| 08    | coffee_ember 7, chocolate pill button              | 1 pill                       | 1 pill                                                        |
| 09    | car_vantra 6, thin white outline button            | 1 outline                    | 1 outline                                                     |
| 10    | fintech_coinly 11, mint gradient backdrop          | 2 flat layers                | 1 gradient (a faint large circle is missed)                   |
| 11    | sports_drink 4, slanted lime panel                 | picture (a pill doesn't fit) | 1 path                                                        |
| 12    | wagwoven 17, off-white card                        | 1 rounded rectangle          | 1 rounded rectangle                                           |
| 13    | skillgrove 14, torn-paper strip                    | picture                      | 1 path                                                        |
| 14    | lipstick_rouge 7, cream pill with a thin dark rim  | picture                      | picture: the rim is lost, caught as a lost part               |
| 15    | hushvale 13, painted purple backdrop               | picture                      | picture                                                       |

The blind judging sheets are in `out/judge-blind/` (01 to 20, in the order of the judging table).

## What production needs

- **Where it lives** (`docs/agents/code-layout.md`, ADR-0001). A new package, `packages/vectorise` (the Layering job's "vectorise" step in `GLOSSARY.md`), holding the pipeline. It depends only on `@dazbee/schema` and `@dazbee/renderer` (it draws to compare), sits beside `packages/svg` (which also turns outside pictures into layers), and returns `UnplacedLayer`s (graphics, with bindings) for the Layering job to place. It runs in **ADR-0001's worker app (`apps/worker`)**, added with the Layering ticket that first needs it, one job at a time: a block can take seconds of CPU, which must not sit in the API's request path, and on one server (ADR-0017) a separate process can run at a lower CPU priority than the API and the sync server. An API worker thread is the fallback if a fourth app is not wanted yet; it shares the API's memory and grows the CanvasKit wasm heap the API's renders use.
- **Contract** (`packages/schema`, ADR-0002): a vectorise job's input (each block's picture as an asset id, its rect on the draft, its kind, the brand kit's colours) and output (per block: `shapes` with layers, or `picture` with why, plus SSIM and ΔE for the record).
- **Tests to keep** (this repo keeps its tests): unit tests beside each module (CIEDE2000 against Sharma's published pairs, SSIM on known pairs, each shape kind's closed-form start, the Bézier fitter's tolerance, the gradient fit, the brand snap and its undo); a fixtures test in `tests/pixels` running synthetic blocks of every kind and degradation through the decision with expected answers and IoU floors; a `test:speed` check on a few blocks.
- **Before shipping**: compiled JavaScript in the worker (the prototype's 5 s cold start is Node compiling TypeScript), placing layers in the draft's coordinates (the block's rect and the GPU job's bucket-to-source stretch the old worker's README describes), layer names through the app's message catalogs, and the fixes listed under risks.

## Risks and limits

- **The rule.** It agreed with blind hand-judgement on 13 of 20 blocks, and Medium's decision on 15 of 20. It misses small lost parts (a thin rim, a faint circle), fails AI grain (above), and is lenient on large blocks because SSIM is computed downsampled. The text half shares it, so a change is the owner's to make for both.
- **Photos.** On DeltaX, 3 of 72 photos and cutouts became shapes. In production the Layering job's own block kinds keep photos and cutouts out of the vectorise step, as the old worker's `convert` list does; an uploaded picture with no kind relies on Medium's scene guard (4 or more free shapes over 30 % of the block, or 10 or more layers with 6 free shapes), which is coarse.
- **Slow tails.** Medium's 95th percentile is 11.8 s a block and the slowest ad 54 s: large gradient backdrops (gradient fitting and band merging at 256 px, the decision at full size) and photos that reach the traced-paths step. Fixes before shipping: send photos to the picture answer before tracing, fit gradients on fewer pixels, stop refining when IoU stops rising.
- **Dashed frames on AI blocks.** The dashes are uneven, the ring doesn't close, and the frame stays a picture (food_delivery 7). Works on 4 of 8 synthetic dashed frames.
- **Thin lines and badges with inner rings** are the weakest synthetic kinds (5 of 9, 4 of 9).
- **Irregular shapes are traced, not fitted.** A real jagged burst or a hand-drawn star comes back as a path, editable as a path, not with a star's points; only regular ones get a star.
- **Names.** A block that fills its crop is named and given the role "background" (coffee_ember's pill is "Chocolate background"); production should take the role from the block's kind.
- **Tuning.** Thresholds were set on the synthetic development part and, for the lost-part check, on the 20 judged blocks; the synthetic numbers are held out, the judged ones are not.
- **Measurement.** One core of a 12-core laptop, not a server CPU. Light's held-out timing was first taken while other work ran on other cores and was taken again alone (the numbers above are the alone run). The old worker decides with its own checks, not the shared rule, so its 141 is not comparable with ours one for one.
- **Prototype code.** Written to answer the question, not to Dazbee's standards: `src/match.ts` is over 1,000 lines, there are no unit tests, and names follow the code, not the glossary (the code says "primitive" for a fitted shape kind). Production rewrites it into the package above.

## How to run

From `prototypes/shape-match` (Node 24 runs the TypeScript directly; `pnpm install` at the root first):

```
node src/synth.ts                         # makes data/synth (312 blocks + index.json)
node src/run-deltax.ts light|medium       # all DeltaX blocks -> out/deltax-<level>.jsonl
node src/run-synth.ts light|medium test   # held-out synthetic part -> out/synth-<level>-test.jsonl
node src/summary.ts synth out/synth-medium-test.jsonl family|degradation|brand
node src/summary.ts deltax out/deltax-medium.jsonl
node src/compare.ts                       # against the old worker's answers and times
node src/examples.ts out/examples <ad>/block_NN.png ...
node src/judge.ts <ad>/block_NN.png ...   # blind judging sheets
timed.ps1                                 # every measurement alone on one core
```

Round 2 adds:

```
SYNTH_SEED=4242 SYNTH_DIR=data/synth2 node src/synth.ts   # the unseen synthetic set
node src/score-old.ts                     # the old worker's answers drawn by Dazbee and scored with both rules
RULE=v2 node src/run-deltax.ts medium     # any run under rule v2 (default: the shared rule)
node src/run-deltax.ts medium dev|frozen  # the 32 development or 16 frozen ads
node src/final.ts                         # every round-2 table
node src/judged.ts                        # agreement with the 20 hand judgements
node --expose-gc src/memory.ts <ad>       # memory, stage by stage
node src/calibrate.ts                     # rule v2's numbers on the judged blocks
timed4.ps1                                # every round-2 measurement on one core
```

The DeltaX ads are read from `ming-setup/test_ads` and never copied in; `data/` and `out/` are git-ignored.
