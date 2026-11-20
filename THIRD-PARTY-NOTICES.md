# Third-party notices

Code in Dazbee that is ported from other projects, with the notice each project's licence asks to keep.

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
- `packages/svg/src/patterns.ts`: a pattern of one picture read as an image paint, fill, fit or cropped where one copy shows and tiled at a scale where it repeats, ported from `pattern` and `lone_image` in `crates/svg/src/import/paint.rs`.
- `packages/schema/src/typography.ts`: letter spacing in pixels or as a percentage of the font size, and what makes a feature tag, ported from `LetterSpacing`, its `resolve` and `valid_feature_tag` in `crates/doc/src/text.rs`.
- `apps/web/lib/editor/font-features.ts`: the OpenType features the Text tab offers, each with whether fonts turn it on by default, from `FEATURES` in `crates/ui-egui/src/panels/typography.rs`.
- `packages/renderer/src/text/small-caps.ts`: small caps made up from capitals at 72% of the size where a font has none, ported from `shape_segment` and `SMALL_CAP_SCALE` in `crates/text/src/layout.rs`.
- `apps/web/lib/editor/letter-spacing.ts`: letter spacing typed as `2%` or `1.5px`, a bare value keeping its unit, after `parse_letter_spacing` in `crates/ui-egui/src/panels/typography/spacing.rs`.

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
