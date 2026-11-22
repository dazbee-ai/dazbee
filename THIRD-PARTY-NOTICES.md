# Third-party notices

Code in Dazbee that is ported from other projects, libraries whose licence asks for a notice, and model weights it starts from, with the notice each project's licence asks to keep.

## FigCraft

From https://github.com/storytold/figcraft at commit `be991533b0cc1891447d8ea48198abc87fdbc609`, used under its MIT licence.

- `packages/editor/src/gestures/hit-zones.ts`: where a press grabs the selection, ported from `handle_at_corners` in `crates/engine/src/canvas/tools/handles.rs`.
- `packages/renderer/src/draw/corners.ts`, `packages/editor/src/layers/radius.ts` and `packages/editor/src/gestures/select/radius-drag.ts`: the corners a radius dot rounds, where it sits on its corner's bisector and the radius a drag sets, ported from `corner`, `corners`, `top`, `Corner::handle` and `Corner::radius` in `crates/engine/src/canvas/shape_handles.rs`.
- `packages/editor/src/gestures/guides/guide-drag.ts`: a frame's guides dragged out of the rulers, moved, copied with Alt, removed on their ruler, picked and nudged, after `input` in `crates/ui-egui/src/canvas/guides.rs` and `guide_key` in `crates/engine/src/canvas/tools/keys.rs`.
- `packages/renderer/src/layout-lines.ts` and the wrapping and limits in `packages/renderer/src/layout.ts`: a size held between a layer's least and most, a flow broken into wrapped lines, filling layers sharing a line by turns, and the room across shared among the lines, ported from `clamp_size`, `flow_lines`, `distribute`, `align_flow_lines` and `layout_frame` in `crates/layout/src/lib.rs`.
- `packages/doc/src/wrap-lines.ts`: the lines a wrapping flow's layers are drawn on, read from where they are drawn, ported from `wrap_rows` in `crates/engine/src/canvas/drop.rs`.
- `packages/editor/src/gestures/select/flow-place.ts` (`linePlace`): the place a point puts dragged layers in a wrapping flow, ported from `wrap_slot` and `wrap_slot_rows` in `crates/engine/src/canvas/drop.rs`.
- `packages/svg/src/filters.ts`: an SVG filter worked out symbolically and read as drop shadows, inner shadows and a layer blur, ported from `crates/svg/src/import/fx.rs`.
- `packages/doc/src/agent/batch.ts`: step references in an agent batch, each named step's result taken whole or through a key or slash path, ported from `BatchScope::reference`, `lookup` and `walk` in `crates/engine/src/automation/batch.rs`.
- `packages/doc/src/agent/tree.ts`: a frame's layers as an outline of ids, names, types, whether each shows and its text cut at 120 characters, with the props asked for, after `InspectOptions` and `text_props` in `crates/engine/src/automation/inspect.rs`, and long lists of layers cut to a size budget by bisection, after `children_window` in `crates/mcp/src/tools.rs`.
- `packages/export/src/agent-render.ts`: a frame drawn for an agent at the scale that fits its longer side to 1600 pixels by default, from 16 to 8192, and never past 2, after `screenshot` in `crates/mcp/src/tools.rs` and `screenshot_png` in `crates/mcp/src/headless.rs`.
- `packages/svg/src/patterns.ts`: a pattern of one picture read as an image paint, fill, fit or cropped where one copy shows and tiled at a scale where it repeats, ported from `pattern` and `lone_image` in `crates/svg/src/import/paint.rs`.
- `packages/schema/src/typography.ts`: letter spacing in pixels or as a percentage of the font size, and what makes a feature tag, ported from `LetterSpacing`, its `resolve` and `valid_feature_tag` in `crates/doc/src/text.rs`.
- `apps/web/lib/editor/font-features.ts`: the OpenType features the Text tab offers, each with whether fonts turn it on by default, from `FEATURES` in `crates/ui-egui/src/panels/typography.rs`.
- `packages/renderer/src/text/small-caps.ts`: small caps made up from capitals at 72% of the size where a font has none, ported from `shape_segment` and `SMALL_CAP_SCALE` in `crates/text/src/layout.rs`.
- `apps/web/lib/editor/letter-spacing.ts`: letter spacing typed as `2%` or `1.5px`, a bare value keeping its unit, after `parse_letter_spacing` in `crates/ui-egui/src/panels/typography/spacing.rs`.
- `packages/renderer/src/text/wrap-style.ts`: Balance as the narrowest width that adds no line and breaks no word, and Pretty ending one of the three lines before a lone last word a word or up to three early, after `restyle_breaks` in `crates/text/src/layout.rs`.

```text
MIT License

Copyright (c) 2026 ArtCraft Team and the FigCraft contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## timm's `convnext_atto.d2_in1k` weights

The text matcher's model, `text-model.onnx` in the release `packages/matchers/src/release.json` names, served at `/matchers/<sha256>.bin`, is a ConvNeXt-Atto that started from timm's `convnext_atto.d2_in1k` weights (https://huggingface.co/timm/convnext_atto.d2_in1k) and was then trained further on drawn font samples, so its weights are changed from the original. timm's code (https://github.com/huggingface/pytorch-image-models) is under the Apache License, Version 2.0 (https://www.apache.org/licenses/LICENSE-2.0).

The model card, read again on 2026-11-22, says in its header `license: apache-2.0` and `datasets: imagenet-1k`, and in its text: "A ConvNeXt image classification model. Trained in `timm` on ImageNet-1k by Ross Wightman." It names the paper "A ConvNet for the 2020s" (Liu, Mao, Wu, Feichtenhofer, Darrell and Xie, CVPR 2022) and asks timm to be cited as Ross Wightman, "PyTorch Image Models", 2019, doi:10.5281/zenodo.4414861.

The weights were trained on ImageNet-1k, whose terms of access let a researcher "use the Database only for non-commercial research and educational purposes". Whether those terms reach weights trained on it is not settled; the owner accepted that grey area for the model's accuracy on 2026-11-22 (ADR-0020). A model trained without ImageNet weights replaces it if that changes.

## harfbuzzjs

harfbuzzjs 1.6.4 (https://github.com/harfbuzz/harfbuzzjs), used under its MIT licence: `packages/fonts/src/match-copy.ts` cuts each Google face to its match copy with the HarfBuzz subsetter that harfbuzzjs builds as WebAssembly (`harfbuzz-subset.wasm`). HarfBuzz itself (https://github.com/harfbuzz/harfbuzz), which that WebAssembly is built from, is under the "Old MIT" licence in its `COPYING`, quoted after harfbuzzjs's.

```text
MIT License

Copyright (c) 2019-2026 The harfbuzzjs project authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

```text
HarfBuzz is licensed under the so-called "Old MIT" license.  Details follow.
For parts of HarfBuzz that are licensed under different licenses see individual
files names COPYING in subdirectories where applicable.

Copyright © 2010-2022  Google, Inc.
Copyright © 2015-2020  Ebrahim Byagowi
Copyright © 2019,2020  Facebook, Inc.
Copyright © 2012,2015  Mozilla Foundation
Copyright © 2011  Codethink Limited
Copyright © 2008,2010  Nokia Corporation and/or its subsidiary(-ies)
Copyright © 2009  Keith Stribley
Copyright © 2011  Martin Hosken and SIL International
Copyright © 2007  Chris Wilson
Copyright © 2005,2006,2020,2021,2022,2023  Behdad Esfahbod
Copyright © 2004,2007,2008,2009,2010,2013,2021,2022,2023  Red Hat, Inc.
Copyright © 1998-2005  David Turner and Werner Lemberg
Copyright © 2016  Igalia S.L.
Copyright © 2022  Matthias Clasen
Copyright © 2018,2021  Khaled Hosny
Copyright © 2018,2019,2020  Adobe, Inc
Copyright © 2013-2015  Alexei Podtelezhnikov

For full copyright notices consult the individual files in the package.


Permission is hereby granted, without written agreement and without
license or royalty fees, to use, copy, modify, and distribute this
software and its documentation for any purpose, provided that the
above copyright notice and the following two paragraphs appear in
all copies of this software.

IN NO EVENT SHALL THE COPYRIGHT HOLDER BE LIABLE TO ANY PARTY FOR
DIRECT, INDIRECT, SPECIAL, INCIDENTAL, OR CONSEQUENTIAL DAMAGES
ARISING OUT OF THE USE OF THIS SOFTWARE AND ITS DOCUMENTATION, EVEN
IF THE COPYRIGHT HOLDER HAS BEEN ADVISED OF THE POSSIBILITY OF SUCH
DAMAGE.

THE COPYRIGHT HOLDER SPECIFICALLY DISCLAIMS ANY WARRANTIES, INCLUDING,
BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND
FITNESS FOR A PARTICULAR PURPOSE.  THE SOFTWARE PROVIDED HEREUNDER IS
ON AN "AS IS" BASIS, AND THE COPYRIGHT HOLDER HAS NO OBLIGATION TO
PROVIDE MAINTENANCE, SUPPORT, UPDATES, ENHANCEMENTS, OR MODIFICATIONS.
```

## ONNX Runtime Web

ONNX Runtime Web 1.31.1 (https://github.com/microsoft/onnxruntime), used under its MIT licence: the text matcher's workers (`packages/editor/src/matching/match-worker.ts`) run its model with the npm package `onnxruntime-web`, its JavaScript bundled into the app and its WebAssembly-only build, `ort-wasm-simd-threaded.wasm`, served from `/vendor/onnxruntime/<version>/`. The third-party code built into that WebAssembly is listed with its licences in ONNX Runtime's `ThirdPartyNotices.txt` (https://github.com/microsoft/onnxruntime/blob/v1.31.1/ThirdPartyNotices.txt).

```text
MIT License

Copyright (c) Microsoft Corporation

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
