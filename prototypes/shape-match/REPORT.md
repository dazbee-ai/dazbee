# Shape matcher prototype: Light and Medium

PROTOTYPE, never merged. Branch `shape-match-prototype`. It answers one question: how should Dazbee's Layering job vectorise the non-text blocks of a flat ad, and is a lean version (Light) as accurate as a fuller one (Medium) on a one-CPU server?

Dazbee's words are used throughout (`GLOSSARY.md`): a block becomes **graphics** (layers made of a **shape** plus fills, strokes and effects), or stays a **picture** (a graphic with an image fill).

## Headline

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

## Recommendation

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

The DeltaX ads are read from `ming-setup/test_ads` and never copied in; `data/` and `out/` are git-ignored.
