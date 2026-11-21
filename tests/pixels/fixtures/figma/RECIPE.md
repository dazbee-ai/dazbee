# The recorded Figma file

The Figma file the record script records once, for the pixel harness (spec #93, F22). It has one frame for each risk in F22's table and one for each of the five fixture themes. Each risk is a guess about Figma that only a real file can check.

## Build it by hand

Build the file by hand in Figma Design, from the sections below. It can't be imported. Figma's own `.fig` format is private, and an SVG pasted into Figma loses text runs, masks, effects and image adjustments, which are the things this file exists to check.

Decision (Claude, 2026-11-21): the recipe is built by hand rather than by a Figma plugin script. A plugin would need the desktop app and code no test here can run, and a hand-built file is what a marketer's file is.

What the values mean:

- Sizes, positions (X and Y in Figma's design panel, relative to the frame), turns, colours, font settings, effects and adjustments are **exact**. Type them in.
- Gradient handles are dragged by hand. They need only match the description. The recording keeps whatever the file holds, and Figma's PNG of the frame is the truth it is compared with.
- "Bottom to top" lists layers in the order you draw them. Figma's layers panel shows them the other way up, with the last one at the top.
- A colour with eight digits ends in its opacity: `#00000040` is black at 25 %. In Figma, type the six digits and set the opacity beside them.

### Fonts and images

- Use only **Noto Sans** Regular (400) and Bold (700), and **Noto Naskh Arabic** Regular. These are the only fonts the pixel harness has. Both are in Figma's Google Fonts.
- The images are the stand-in photos in `tests/pixels/assets/`: `sneaker.jpg`, `card-1.jpg`, `card-2.jpg`, `card-3.jpg`, `tile.jpg` and `cutout.png`. To use one as a fill: Fill → the swatch → Image → Choose image, then pick its mode (Fill, Fit, Crop or Tile).

### Pages and frames

- Create a new Design file named **Dazbee recording**.
- Name its first page **Risks** and add a second page, **Themes**.
- Make each frame with the Frame tool (F). Set its W and H, and name it exactly as written. Leave its fill white (`#FFFFFF`) unless the frame says otherwise.
- Put the frames in a row, at least 200 px apart, in the order given. Where they sit on the page doesn't matter, as long as no two overlap and no frame lies inside another. The one exception is the loose layers in [Components, sections and loose layers](#components-sections-and-loose-layers).

## Where each risk and theme is checked

| F22 risk                                                | Checked by                                                                                     |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| angular starts along h2 − h1 and turns from a towards u | [Angular](#angular)                                                                            |
| linear and radial handle maths (F9)                     | [Resized gradients](#resized-gradients) and [Skewed gradients](#skewed-gradients)              |
| shadow offsets turn with the layer                      | [Turned shadow](#turned-shadow)                                                                |
| `characterStyleOverrides` counts UTF-16 code units      | [Emoji run](#emoji-run)                                                                        |
| group children are in the frame's or the group's space  | [Nested group](#nested-group)                                                                  |
| `/files?ids=` returns the node's ancestors              | the second run, a link to the layer **B** in [Nested group](#nested-group) (`node-link.json`)  |
| a mirrored layer's matrix is a flip then a turn         | [Flipped text](#flipped-text), [Flipped box](#flipped-box) and [Flipped image](#flipped-image) |
| Figma's sign-in redirect and error parameters           | no frame: the owner's first sign-in through the draft OAuth app (9.3d3) checks it              |
| `imageTransform` maps the unit box into the image       | [Stretched image](#stretched-image)                                                            |
| filter strengths ×100                                   | [Filters](#filters)                                                                            |
| nested masks (F12)                                      | [Two masks](#two-masks)                                                                        |
| a hidden mask masks nothing, as in Dazbee               | [Hidden mask](#hidden-mask)                                                                    |
| image URLs need no token, and their hosts               | every frame with an image fill: the recording's `imageHosts` and `failedImages` in `file.json` |
| text wraps alike for the same font and width            | [Fixed text](#fixed-text)                                                                      |

| Fixture theme (F22)                                                          | Frame                                                                          |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| 1. photo card ad with shadows                                                | [Photo card ad](#photo-card-ad)                                                |
| 2. auto layout story with text styles and runs                               | [Auto layout story](#auto-layout-story)                                        |
| 3. vectors, booleans, masks, mirrored and turned paths                       | [Vectors and masks](#vectors-and-masks)                                        |
| 4. gradients, including skewed handles, oval radial, angular and tile images | [Gradients and images](#gradients-and-images)                                  |
| 5. components, sections, loose layers and every left-out type                | [Components, sections and loose layers](#components-sections-and-loose-layers) |

## Page "Risks"

### Angular

Frame 400 × 400.

| Layer, bottom to top | What                | Settings                                                                                                                                                                                                                                      |
| -------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Default              | Rectangle 160 × 160 | X 20, Y 20. Fill Angular, stops `#FF0000` at 0 %, `#00FF00` at 50 %, `#0000FF` at 100 %. Leave the handles where Figma puts them.                                                                                                             |
| Turned               | Rectangle 160 × 160 | X 220, Y 20. The same three stops. Drag the end handle (the dot on the ring) a quarter turn clockwise, so the red-to-blue seam points straight down.                                                                                          |
| Reversed             | Rectangle 160 × 160 | X 20, Y 220. The same three stops. Drag the width handle (the second dot) across to the other side of the end handle, so blue now follows red going anticlockwise. If Figma won't let it cross, leave it where it stops and say so in the PR. |
| Wide                 | Rectangle 160 × 80  | X 220, Y 220. The same three stops, handles where Figma puts them. Its sides differ, so its sweep isn't even in the unit box.                                                                                                                 |

### Resized gradients

Frame 440 × 460.

| Layer, bottom to top | What      | Settings                                                                                                                                                                                                                                                                                                  |
| -------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Linear               | Rectangle | Draw it 200 × 200 at X 20, Y 20. Fill Linear, `#FF006E` at 0 % to `#3A86FF` at 100 %. Drag the start handle onto the top-left corner and the end handle onto the bottom-right corner. Then type W 400 (H stays 200). Its lines of equal colour are now not perpendicular to the handle line in pixels.    |
| Radial               | Rectangle | Draw it 200 × 200 at X 20, Y 240. Fill Radial, `#FFFFFF` at 0 % to `#8338EC` at 100 %. Drag the end handle onto the top-right corner, so the circle's axes turn 45°, and drag the width handle in to half that length, so it is an oval. Then type W 400 (H stays 200). Its oval is now skewed in pixels. |

### Skewed gradients

Frame 600 × 600. Figma skews a turned layer when the group holding it is stretched in one direction.

| Layer, bottom to top                       | What                        | Settings                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------ | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Slanted bar, in group **Slant 1**          | Rectangle 200 × 100         | X 60, Y 60. Fill Linear, `#FB5607` to `#FFBE0B`, start handle on the left edge's middle, end on the right edge's middle. Rotation 30°. Group it (Ctrl/Cmd + G), name the group **Slant 1**, then drag the group's right edge out until the group is 1.6 times as wide, without Shift. The bar should now be a parallelogram whose corners aren't right angles. |
| Slanted oval, in group **Slant 2**         | Ellipse 160 × 160           | X 340, Y 60. Fill Radial, `#FFFFFF` to `#06D6A0`, handles where Figma puts them. Rotation 45°. Group it as **Slant 2**, then drag the group's bottom edge down until it is twice as tall.                                                                                                                                                                      |
| Slanted text and box, in group **Slant 3** | Text "Skew" and a rectangle | Text: Noto Sans Bold 64, `#1A1A1A`, auto width, X 60, Y 380. Rectangle 120 × 80, fill `#118AB2`, X 300, Y 380. Rotate both 20°, group them as **Slant 3**, then drag the group's right edge out until it is 1.5 times as wide.                                                                                                                                 |

### Turned shadow

Frame 400 × 400, fill `#F0F0F0`.

| Layer, bottom to top | What                | Settings                                                                                                                                                                                            |
| -------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Upright              | Rectangle 100 × 100 | X 30, Y 30, fill `#FFFFFF`, radius 12. Drop shadow X 16, Y 0, blur 8, spread 0, `#000000` at 60 %.                                                                                                  |
| Turned               | Rectangle 160 × 160 | X 160, Y 160, fill `#FFFFFF`, radius 16. Drop shadow X 24, Y 0, blur 8, spread 0, `#000000` at 60 %. Rotation 90°. If the offset turns with the layer, the shadow falls below it, not to its right. |

### Emoji run

Frame 400 × 300. Both texts are Noto Sans Regular 40, `#1A1A1A`, auto width. The harness has no emoji font, so the emoji themselves draw differently. What is checked is the style of the words after them.

| Layer, bottom to top | What                      | Settings                                                        |
| -------------------- | ------------------------- | --------------------------------------------------------------- |
| Wave                 | Text "Hi 👋 there friend" | X 20, Y 40. Select only "there": Bold, fill `#E63946`.          |
| Two emoji            | Text "😀😀 ok then"       | X 20, Y 160. Select only "ok": Bold, fill `#2A9D8F`, underline. |

### Nested group

Frame 400 × 400. Build the inner group first.

| Layer, bottom to top                   | What              | Settings                                                                                                                                                                    |
| -------------------------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A, in group **Outer**                  | Rectangle 80 × 80 | X 40, Y 40, fill `#2A9D8F`.                                                                                                                                                 |
| B, in group **Inner** inside **Outer** | Rectangle 80 × 80 | X 200, Y 200, fill `#E9C46A`.                                                                                                                                               |
| C, in group **Inner** inside **Outer** | Ellipse 60 × 60   | X 300, Y 100, fill `#F4A261`.                                                                                                                                               |
| Turned box, in group **Outer**         | Frame 120 × 80    | A frame nested in this frame (it becomes a box), X 60, Y 260, fill `#264653`, rotation 15°. Inside it, rectangle **D** 40 × 40 at X 10, Y 10, fill `#E76F51`, rotation 30°. |

Then select B and C and group them as **Inner**, rotation 20°. Select A, Inner and Turned box and group them as **Outer**, rotation 10°.

After the first recording, right-click **B** → Copy link to selection. That is the link for the second run.

### Flipped text

Frame 400 × 400. All three are Noto Sans Bold 64, `#1D3557`, auto width, text "Mirror".

| Layer, bottom to top | Settings                                         |
| -------------------- | ------------------------------------------------ |
| Left to right        | X 40, Y 40, then Flip horizontal (Shift + H).    |
| Top to bottom        | X 40, Y 160, then Flip vertical (Shift + V).     |
| Turned and flipped   | X 40, Y 280, rotation 30°, then Flip horizontal. |

### Flipped box

Frame 500 × 400. Each box is a frame nested in this frame, 200 × 120, fill Linear `#457B9D` to `#A8DADC` from left to right, corner radius 24 on the top-left corner only (the other three 0), clip content on. Each holds a rectangle 60 × 40 at X 10, Y 10, fill `#E63946`, which shows which way it was flipped.

| Layer, bottom to top   | Settings                                          |
| ---------------------- | ------------------------------------------------- |
| Box flipped across     | X 20, Y 20, then Flip horizontal.                 |
| Box flipped down       | X 260, Y 20, then Flip vertical.                  |
| Box turned and flipped | X 140, Y 220, rotation 15°, then Flip horizontal. |

### Flipped image

Frame 560 × 220.

| Layer, bottom to top | What                | Settings                                                    |
| -------------------- | ------------------- | ----------------------------------------------------------- |
| Across               | Rectangle 240 × 160 | X 20, Y 30, image `card-1.jpg`, Fill. Then Flip horizontal. |
| Down                 | Rectangle 240 × 160 | X 300, Y 30, image `card-1.jpg`, Fill. Then Flip vertical.  |

### Stretched image

Frame 560 × 260. Figma's Crop mode is what its file calls STRETCH, with an `imageTransform`.

| Layer, bottom to top | What                | Settings                                                                                                                            |
| -------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Cropped              | Rectangle 300 × 200 | X 20, Y 30, image `sneaker.jpg`, Crop. Drag the crop box so only the right half of the photo shows, enlarged to fill the rectangle. |
| Cropped and turned   | Rectangle 200 × 200 | X 340, Y 30, image `sneaker.jpg`, Crop. Press the image's Rotate 90° button once, then crop to the middle third.                    |

### Filters

Frame 560 × 248. Eight rectangles 120 × 100, each with image `card-2.jpg` in Fill mode and one adjustment set in the image fill's settings. Columns at X 16, 152, 288 and 424; rows at Y 16 and 132.

| Layer, bottom to top | X, Y     | Adjustment      |
| -------------------- | -------- | --------------- |
| None                 | 16, 16   | none            |
| Exposure             | 152, 16  | Exposure 50     |
| Contrast             | 288, 16  | Contrast 50     |
| Saturation           | 424, 16  | Saturation −100 |
| Temperature          | 16, 132  | Temperature 50  |
| Tint                 | 152, 132 | Tint 50         |
| Highlights           | 288, 132 | Highlights 50   |
| Shadows              | 424, 132 | Shadows −50     |

### Two masks

Frame 840 × 400. The same four layers twice: first in a group, then straight in a box. In Figma an earlier mask also masks the later mask and its layers, so the pink band should show only where the circle and the star overlap.

The four layers, bottom to top:

| Layer  | What                | Settings                                                                              |
| ------ | ------------------- | ------------------------------------------------------------------------------------- |
| Mask 1 | Ellipse 300 × 300   | X 50, Y 50, fill `#000000`. Use as mask (Ctrl/Cmd + Alt/Option + M); mask type Alpha. |
| Photo  | Rectangle 400 × 400 | X 0, Y 0, image `card-3.jpg`, Fill.                                                   |
| Mask 2 | Star 240 × 240      | X 80, Y 80, 5 points, ratio 40 %, fill `#000000`. Use as mask; mask type Alpha.       |
| Band   | Rectangle 400 × 200 | X 0, Y 100, fill `#FF006E`.                                                           |

1. **In a group**, at the frame's left. Draw Mask 1 and Photo, select both and Use as mask: Figma makes a group named "Mask group" with Mask 1 at its bottom. Draw Star and Band, and drag both into that group in the layers panel, above Photo. Select only the star and Use as mask. The group then holds, from the bottom up: Mask 1 (mask), Photo, Mask 2 (mask), Band.
2. **In a box**, at the frame's right. Add a frame nested in this one, 400 × 400 at X 420, Y 0, named **Masks box**, with no auto layout. Draw the same four layers straight inside it, with positions relative to the box, and turn on Use as mask for Mask 1 and for the star, one at a time. Nothing goes into a group.

### Hidden mask

Frame 400 × 400.

| Layer, bottom to top, in one group | What                | Settings                                                                               |
| ---------------------------------- | ------------------- | -------------------------------------------------------------------------------------- |
| Hidden mask                        | Ellipse 200 × 200   | X 100, Y 100, fill `#000000`. Use as mask, then hide it (the eye in the layers panel). |
| Photo                              | Rectangle 400 × 400 | X 0, Y 0, image `card-3.jpg`, Fill.                                                    |

If a hidden mask masks nothing, Figma's PNG shows the whole photo.

### Fixed text

Frame 400 × 600. Each text uses Figma's Fixed size resizing: type its W and H after choosing Fixed size. Line height Auto.

| Layer, bottom to top | Settings                                                                                                                                             |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wide                 | "The quick brown fox jumps over the lazy dog while the market opens at nine." Noto Sans Regular 28, `#1A1A1A`, align left, W 300, H 200, X 20, Y 20. |
| Narrow               | "Wrapping changes when widths change by a pixel." Noto Sans Bold 32, `#1A1A1A`, align center, W 180, H 260, X 20, Y 240.                             |
| Arabic               | "النص العربي يلتف داخل مربع ثابت العرض" Noto Naskh Arabic Regular 28, `#1A1A1A`, align left, W 160, H 260, X 220, Y 240.                             |

## Page "Themes"

### Photo card ad

Frame 1080 × 1080, fill `#F4EFE6`.

| Layer, bottom to top | What                | Settings                                                                                                                                          |
| -------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Card                 | Rectangle 800 × 800 | X 140, Y 140, fill `#FFFFFF`, radius 32. Drop shadow X 0, Y 24, blur 48, spread 0, `#000000` at 20 %.                                             |
| Photo                | Rectangle 800 × 500 | X 140, Y 140, image `sneaker.jpg`, Fill. Corner radius: top-left 32, top-right 32, bottom-right 0, bottom-left 0.                                 |
| Headline             | Text "Run lighter"  | Noto Sans Bold 72, `#1A1A1A`, auto width, letter spacing −1 px, X 200, Y 690.                                                                     |
| Price pill           | Rectangle 220 × 80  | X 720, Y 820, fill `#FF5A36`, radius 40. Inner shadow X 0, Y −4, blur 8, spread 0, `#000000` at 25 %.                                             |
| Price                | Text "$89"          | Noto Sans Bold 40, `#FFFFFF`, auto width, centred on the pill (X and Y so it sits in the pill's middle).                                          |
| Badge                | Ellipse 160 × 160   | X 840, Y 80, fill `#1A1A1A` at 80 % opacity. Drop shadow X 0, Y 8, blur 16, spread 4, `#000000` at 40 %, with "Show behind transparent areas" on. |
| Badge word           | Text "NEW"          | Noto Sans Bold 36, `#FFFFFF`, auto width, centred on the badge.                                                                                   |
| Cutout               | Rectangle 260 × 260 | X 100, Y 760, image `cutout.png`, Fit, rotation −12°. Drop shadow X 12, Y 12, blur 20, spread 0, `#000000` at 30 %.                               |

### Auto layout story

Frame 1080 × 1920, fill `#0E1B2C`. Give the frame itself auto layout (Shift + A): vertical, padding 96 on every side, gap 48, items top-left.

| Layer, top to bottom in the flow | What                                                                     | Settings                                                                                                                                                                                                                                                                                                                                                         |
| -------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Headline                         | Text "Summer drop"                                                       | Noto Sans Bold 120, `#FFFFFF`, line height 110 %, letter spacing −2 px, resizing Auto height, width Fill container.                                                                                                                                                                                                                                              |
| Body                             | Text "Three new colours, one weekend only. Free returns on everything."  | Noto Sans Regular 44, `#D9E2EC`, line height 64 px, Auto height, width Fill container. Select "one weekend only": Bold, fill `#FFC83D`. Select "Free returns": underline. Select "everything": font size 56 (its line height stays the paragraph's 64 px).                                                                                                       |
| Tags                             | Frame                                                                    | Horizontal auto layout, gap 24, wrap on, gap between rows 16, width Fill container, height Hug. Inside, five tags, each a frame with horizontal auto layout, padding 16 top and bottom, 28 left and right, radius 999, fill `#FFFFFF` at 10 %, hug both ways, holding one text in Noto Sans Regular 36, `#FFFFFF`: "Linen", "Sand", "Olive", "Clay", "Midnight". |
| Cards                            | Frame                                                                    | Auto layout Grid, 2 columns, 2 rows, column gap 24, row gap 32, width Fill container, height Hug. Inside, four rectangles of height 200, width Fill, fill `#23364F`, radius 24, in order. If your Figma has no Grid layout, use a wrapping horizontal layout of the same four at width 420 and say so in the PR.                                                 |
| Small caps                       | Text "limited stock"                                                     | Noto Sans Regular 36, `#FFC83D`, letter spacing 2 px, Type details → Case: Small caps. Auto width.                                                                                                                                                                                                                                                               |
| Truncated                        | Text "Ends Sunday at midnight, while stock lasts, in every store we run" | Noto Sans Regular 36, `#D9E2EC`, resizing Truncate text with Max lines 1, width Fill container.                                                                                                                                                                                                                                                                  |
| Arabic                           | Text "تخفيضات الصيف"                                                     | Noto Naskh Arabic Regular 56, `#FFFFFF`, align left, Auto width.                                                                                                                                                                                                                                                                                                 |
| Button                           | Frame                                                                    | Horizontal auto layout, padding 28 top and bottom, 56 left and right, items centred, radius 999, fill `#FFC83D`, min width 360, hug. Inside, text "Shop now", Noto Sans Bold 44, `#0E1B2C`.                                                                                                                                                                      |
| Sticker                          | Ellipse 160 × 160                                                        | Fill `#FF5A36`. In the auto layout settings, turn on Absolute position, then X 860, Y 60.                                                                                                                                                                                                                                                                        |

### Vectors and masks

Frame 1080 × 1080.

| Layer, bottom to top | What                      | Settings                                                                                                                                                                                                                                                          |
| -------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wave                 | Open vector, Pen tool (P) | Three curves in a wave from about X 40, Y 120 to X 440, Y 120, rising and falling about 60 px. No fill; stroke 12, `#2B59C3`, round caps.                                                                                                                         |
| Cup                  | Open vector, Pen tool     | A U shape from X 520, Y 60 down to Y 220 and back up to X 760, Y 60, left open at the top. Fill `#FFD166`, stroke 8 `#073B4C`. Figma fills it as if closed; the stroke has no closing edge.                                                                       |
| Regions              | Vector, Pen tool          | A square 200 × 200 at X 820, Y 40, with one more line from the middle of its top edge to the middle of its bottom edge, so it has two regions. Fill `#CCCCCC`. In vector edit mode, use the Paint bucket (B) to fill only the left region with `#EF476F`.         |
| Star                 | Star 200 × 200            | X 40, Y 300, 7 points, ratio 45 %, fill `#EF476F`, rotation 20°.                                                                                                                                                                                                  |
| Hexagon              | Polygon 200 × 200         | X 300, Y 300, 6 sides, fill `#118AB2`, rotation 30°, then Flip horizontal.                                                                                                                                                                                        |
| Crescent             | Boolean Subtract          | Ellipse 240 × 240 at X 560, Y 300, fill `#06D6A0`; above it, ellipse 160 × 160 at X 640, Y 320. Select both → Subtract selection.                                                                                                                                 |
| Cross                | Boolean Union             | Rectangle 200 × 60 at X 820, Y 390; rectangle 60 × 200 at X 890, Y 320, rotation 15°. Select both → Union selection. Fill `#FFD166`.                                                                                                                              |
| Letters              | Boolean Exclude           | Rectangle 260 × 160 at X 40, Y 580, fill `#073B4C`; above it, text "AB" Noto Sans Bold 160 at X 60, Y 570. Select both → Exclude selection.                                                                                                                       |
| Mirrored pair        | Group                     | A star 120 × 120 (5 points, ratio 40 %) at X 340, Y 600 with fill Linear `#8338EC` to `#FF006E` left to right, and a wave like Wave at X 480 to 640, Y 660, stroke 8 `#8338EC`. Group them as **Mirrored pair**, then Flip horizontal on the group.               |
| Turned path          | Vector, Pen tool          | A closed arrow shape about 200 × 100 at X 740, Y 600, fill `#E76F51`, rotation 45°.                                                                                                                                                                               |
| Masked photo         | Mask group                | Ellipse 300 × 300 at X 40, Y 760; above it, rectangle 400 × 300 at X 0, Y 760 with image `sneaker.jpg`, Fill. Select both → Use as mask; mask type Alpha.                                                                                                         |
| Faded photo          | Mask group                | Rectangle 400 × 280 at X 600, Y 780, fill Linear `#FFFFFF` at the left to `#000000` at the right; above it, rectangle 400 × 280 at X 600, Y 780 with image `card-1.jpg`, Fill. Select both → Use as mask, then set mask type Luminance on the gradient rectangle. |

### Gradients and images

Frame 1080 × 1080.

| Layer, bottom to top | What                | Settings                                                                                                                                                        |
| -------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Oval radial          | Rectangle 400 × 200 | X 40, Y 40. Fill Radial, `#FFFFFF` to `#3A0CA3`, handles where Figma puts them: Figma's default radial in a wide box is an oval that fills it.                  |
| Skewed linear        | Rectangle           | As Linear in [Resized gradients](#resized-gradients): drawn 200 × 200 at X 520, Y 40 with handles corner to corner, then W 400. Colours `#F72585` to `#4CC9F0`. |
| Skewed radial        | Rectangle           | As Radial in [Resized gradients](#resized-gradients): drawn 200 × 200 at X 40, Y 300, turned and squeezed handles, then W 400. Colours `#FFFFFF` to `#F72585`.  |
| Angular              | Ellipse 200 × 200   | X 520, Y 300. Fill Angular, `#F72585` 0 %, `#4CC9F0` 50 %, `#F72585` 100 %, end handle dragged to point up.                                                     |
| Diamond              | Rectangle 200 × 200 | X 780, Y 300. Fill Diamond, `#FFFFFF` to `#7209B7`, handles where Figma puts them.                                                                              |
| Gradient stack       | Rectangle 400 × 200 | X 40, Y 560. Two fills: image `card-2.jpg` Fill below, Linear `#00000000` at the top to `#000000CC` at the bottom above it.                                     |
| Tiles                | Rectangle 400 × 300 | X 520, Y 560, image `tile.jpg`, Tile, scale 50 %.                                                                                                               |
| Fitted               | Rectangle 300 × 200 | X 40, Y 820, fill `#E0E0E0`, then a second fill above it: image `cutout.png`, Fit.                                                                              |
| Gradient stroke      | Ellipse 200 × 200   | X 520, Y 860, no fill, stroke 16 Inside, Linear `#F72585` to `#4CC9F0`.                                                                                         |

### Components, sections and loose layers

On page "Themes", after the frames above:

1. **Button** (a component, top-level). Frame 320 × 100, horizontal auto layout, padding 24, items centred, fill `#2B59C3`, radius 16, holding text "Buy" Noto Sans Bold 40 `#FFFFFF`. Select it → Create component (Ctrl/Cmd + Alt/Option + K).
2. **Button copy** (an instance, top-level). Alt/Option-drag the Button component to make an instance beside it, and change its text to "Buy now".
3. **Components** (frame 1080 × 1080, fill `#FFFFFF`). Inside it:
   - An instance of Button at X 40, Y 40, its fill overridden to `#EF476F`.
   - A slice (Slice tool, S) 300 × 300 at X 400, Y 40.
   - A rectangle 200 × 200 at X 40, Y 300, fill `#118AB2`, with Constraints right and bottom.
   - A nested frame 300 × 200 at X 820, Y 300, fill `#FFD166`, with clip content off, holding a rectangle 200 × 100 at X 200, Y 150, fill `#073B4C`, which passes the nested frame's edge.
   - A locked rectangle (lock in the layers panel) 200 × 100 at X 40, Y 600, fill `#06D6A0`, with blend mode Multiply.
   - A text "Corner" Noto Sans Regular 32 at X 300, Y 600, with blend mode Linear burn.
   - If your Figma offers it, text on a path (Type tool along a curve) at X 40, Y 800. Figma Design files can't hold FigJam's types (stickies, connectors, shapes with text, tables), so those stay out.
4. **Section**. Draw a section (Shift + S) about 1000 × 600, and inside it two frames 400 × 400 named **In section A** (fill `#F4A261`) and **In section B** (fill `#2A9D8F`), side by side.
5. **Loose layers**: on the page itself, outside every frame and section, a rectangle 200 × 200 named **Loose box** (fill `#E63946`) and a text "Loose" Noto Sans Bold 48 to its right.
6. **Hidden frame**: frame 400 × 400 holding a rectangle, then hidden with the eye in the layers panel.
7. **Locked frame**: frame 400 × 400 holding an ellipse, then locked.
8. **Turned frame**: frame 400 × 300 holding a rectangle 200 × 100 at X 100, Y 100 (fill `#118AB2`), then the frame itself rotated 15°.
9. **Small frame**: frame 24 × 24 holding an ellipse 16 × 16 at X 4, Y 4, fill `#E63946`.
10. **Wide frame**: frame 2000 × 100 (20:1), fill `#FFD166`, holding text "A banner twenty times as wide as it is tall" Noto Sans Bold 48 at X 40, Y 20.
11. **Tall frame**: frame 1440 × 9000, fill `#F0F0F0`, holding a rectangle 1240 × 200 at X 100, Y 100 and another at X 100, Y 8700, both fill `#2B59C3`.
12. **Unnamed frame**: frame 200 × 200 holding a rectangle; clear its name in the layers panel so it is empty. If Figma puts a name back, leave the one it gives.

## Record it

The owner, or anyone with a Figma account, records the file once, after the record script merges and before the pixel harness ticket (9.3a3c). The token never goes into this repo, a file, a chat or a command line.

1. **Make a token.** In Figma: your account menu → Settings → Security → Personal access tokens → Generate new token. Pick the shortest expiry offered. Give it one scope, **File content: Read-only** (`file_content:read`), and no access to anything else. Copy it once.
2. **Set it in your own shell**, typed at a hidden prompt, so it stays out of your shell's history:
   - PowerShell: `$env:FIGMA_TOKEN = Read-Host 'Figma token' -MaskInput`
   - bash or zsh: `read -rs FIGMA_TOKEN && export FIGMA_TOKEN`
3. **Record the file.** In Figma, Share → Copy link (a link to the file, with no `node-id`). From the repo's root, quoting the link:
   `pnpm --filter @dazbee/figma record 'https://www.figma.com/design/<key>/Dazbee-recording'`
   It makes three calls to the Figma API: the file, its image list and one render of every visible top-level frame. It then downloads the images and renders, with no token. The recording replaces `tests/pixels/fixtures/figma/recorded/` only once every file is written:
   - `file.json`: the file with `geometry=paths`, names and ids kept. Under `recording` it lists the image hosts, each saved image and render, and every one that failed and why. It holds no token and no image URL.
   - `images/<imageRef>.<png|jpg|gif|webp>`: each image fill's bytes, named by what the bytes are.
   - `figma/<frame id>.png`: Figma's own PNG of each top-level frame at scale 1, `1:2` written as `1-2`.
4. **Record the node link.** Copy the link to the layer **B** in [Nested group](#nested-group) (right-click → Copy link to selection), then run the same command with that link. It makes one call and writes `recorded/node-link.json`, which says whether Figma sent back the layer's page.
5. **Delete the token.** In Figma's Personal access tokens, revoke it. Then clear it from the shell: `Remove-Item Env:FIGMA_TOKEN` in PowerShell, or `unset FIGMA_TOKEN` in bash or zsh.
6. **Commit the recording**: `git add tests/pixels/fixtures/figma/recorded` and commit it on a branch, with a PR. Before committing, `git grep -n figd_ -- tests/pixels/fixtures/figma` should find nothing (Figma's personal tokens start with `figd_`).

The first run uses two of Figma's Tier 1 calls and one Tier 2 call, and the node link one more Tier 1 call. Figma allows Full and Dev seats 10 to 20 Tier 1 calls a minute, but View and Collab seats only about 20 a month, so record from a Full or Dev seat. A 429 says when to try again. The script never retries on its own.
