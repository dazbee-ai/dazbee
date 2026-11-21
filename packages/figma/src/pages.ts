// A Figma file's pages and their top-level frames as Dazbee pages and frames. A frame is brought to
// whole pixels within the sizes a frame can be; what a Dazbee frame can't carry itself (strokes,
// corners, effects, opacity, a blend mode, auto layout), or a size it had to change, puts its
// content in a box of Figma's size inside it. Sections go and their frames stay; layers outside
// any frame go into one frame that fits them.

import type { z } from 'zod'

import type { CanvasKit } from '@dazbee/canvaskit'
import { boundsOf } from '@dazbee/doc'
import type { FigmaFrame, FigmaImport, FigmaPage, Rect } from '@dazbee/schema'
import { SIZE_LIMITS } from '@dazbee/schema'

import { COMPONENT_TYPES, FRAME_TYPES, type LayerBuild, newLayerBuild, type Piece } from './build.ts'
import { isUpright, placed, placementOf, spaceOf } from './geometry.ts'
import { type Corners, cornersOf } from './graphics.ts'
import { boxAround, boxLook, convertLayers, laysOut, treeOf } from './layers.ts'
import { type LinkTarget, pageOf } from './link-target.ts'
import { bool, boxOf, field, type FigmaFields, type FigmaNode, list, num, record, str } from './read.ts'
import type { Reporter } from './report.ts'

type FrameInput = z.input<typeof FigmaFrame>
type PageInput = z.input<typeof FigmaPage>

/** The frame loose layers on a page are put in. */
const OUTSIDE_FRAMES = 'Outside frames'

const MAX_FRAME_NAME = 120
const PLAIN_BLENDS: ReadonlySet<string> = new Set(['PASS_THROUGH', 'NORMAL'])

/** The pages a link's target imports, and whether they go in as pages or onto the page shown. */
export function importPages(
  document: FigmaNode,
  target: LinkTarget,
  report: Reporter,
  ck: CanvasKit,
): { pages: PageInput[]; target: FigmaImport['target'] } {
  switch (target.kind) {
    case 'file':
      return {
        pages: document.children.flatMap((p) => (p.type === 'CANVAS' ? (pageFrom(p, p.name, report, ck) ?? []) : [])),
        target: 'pages',
      }
    case 'page':
      return { pages: [pageFrom(target.page, target.page.name, report, ck)].filter((p) => p !== null), target: 'pages' }
    case 'section':
      return { pages: [pageFrom(target.node, target.node.name, report, ck)].filter((p) => p !== null), target: 'pages' }
    case 'frame':
      return { pages: onePage(target.node, topLevelFrame(target.node, report, ck)), target: 'shown-page' }
    case 'alone':
      report.add('linked-layer-alone', target.node)
      return { pages: onePage(target.node, aloneFrame(target.node, report, ck)), target: 'shown-page' }
  }
}

/**
 * A page holding the frames among `holder`'s children, sections opened in place, and one more
 * holding its loose layers; null, reported, when it would hold none.
 */
function pageFrom(holder: FigmaNode, name: string, report: Reporter, ck: CanvasKit): PageInput | null {
  const frames: FrameInput[] = []
  const loose: FigmaNode[] = []
  const stack = [...holder.children].reverse()
  for (let n = stack.pop(); n; n = stack.pop()) {
    if (n.type === 'SECTION' && n.id) {
      if (field(n.fields, 'visible') === false) {
        report.add('hidden-frames', n)
        continue
      }
      report.add('sections', n)
      for (let i = n.children.length - 1; i >= 0; i--) stack.push(n.children[i] as FigmaNode)
    } else if (FRAME_TYPES.has(n.type) && n.id) {
      const frame = topLevelFrame(n, report, ck)
      if (frame) frames.push(frame)
    } else {
      loose.push(n)
    }
  }
  const outside = looseFrame(holder, loose, report, ck)
  if (outside) frames.push(outside)
  if (frames.length === 0) {
    report.add('empty-pages', holder)
    return null
  }
  return { name: name || 'Page', figmaId: holder.id, frames }
}

function onePage(node: FigmaNode, frame: FrameInput | null): PageInput[] {
  const page = pageOf(node)
  return frame ? [{ name: page?.name || 'Page', figmaId: page?.id ?? '', frames: [frame] }] : []
}

/** A frame at the top of a page as a Dazbee frame; null, reported, when it is hidden or can't be placed. */
function topLevelFrame(n: FigmaNode, report: Reporter, ck: CanvasKit): FrameInput | null {
  const b = boxOf(n.fields)
  if (!b) {
    report.add('unreadable-layers', n)
    return null
  }
  if (field(n.fields, 'visible') === false) {
    report.add('hidden-frames', n)
    return null
  }
  if (field(n.fields, 'locked') === true) report.add('locked-frames', n)
  if (field(n.fields, 'clipsContent') === false) report.add('frames-unclipped', n)
  if (COMPONENT_TYPES.has(n.type)) report.add('components-and-instances', n)
  // A frame doesn't turn: it comes in upright where its box is, and its content where Figma draws it.
  if (!isUpright(placementOf(n, spaceOf(n.parent))?.world)) report.add('frames-turned', n)
  const build = newLayerBuild(n.children, report, ck)
  const { pieces } = convertLayers(build, n.children, b, laysOut(n.fields))
  return frameOf(build, n, n.name, b, pieces, carriesBoxProps(n.fields) ? boxLook(n.fields) : null)
}

/** The frame a page's loose layers go into, fitting them; null when none of them makes a layer. */
function looseFrame(page: FigmaNode, loose: FigmaNode[], report: Reporter, ck: CanvasKit): FrameInput | null {
  if (loose.length === 0) return null
  const build = newLayerBuild(loose, report, ck)
  const { pieces, made } = convertLayers(build, loose, { x: 0, y: 0 }, false)
  if (pieces.length === 0) return null
  for (const n of made) report.add('outside-frames', n)
  // Made in the page's pixels, the layers move by the corner of the box that fits them.
  const fit = boundsOf(pieces.map((p) => p.box))
  for (const layer of Object.values(build.nodes)) {
    layer.props.x -= fit.x
    layer.props.y -= fit.y
  }
  const at = { x: fit.x, y: fit.y, width: Math.ceil(fit.width), height: Math.ceil(fit.height) }
  return frameOf(build, page, OUTSIDE_FRAMES, at, pieces, null)
}

/** A layer inside a frame, imported on its own in a frame of its size. */
function aloneFrame(n: FigmaNode, report: Reporter, ck: CanvasKit): FrameInput | null {
  const b = boxOf(n.fields)
  if (!b) {
    report.add('unreadable-layers', n)
    return null
  }
  const build = newLayerBuild([n], report, ck)
  const { pieces } = convertLayers(build, [n], b, false)
  return frameOf(build, n, n.name, b, pieces, null)
}

/**
 * A frame for `pieces` at `at` on its page: its size brought to whole pixels a frame can be, each
 * change reported. When it carries `boxProps`, or its size had to change, the pieces go into a box
 * of `at`'s size at its top left, which follows the frame's edges when the frame is resized.
 */
function frameOf(
  build: LayerBuild,
  from: FigmaNode,
  name: string,
  at: Rect,
  pieces: Piece[],
  boxProps: { clip: boolean; cornerRadius: Corners } | null,
): FrameInput {
  const place = placed(build.report, from, at, { x: 0, y: 0 })
  const size = frameSize(place.width, place.height)
  if (size.rounded) build.report.add('frames-rounded', from)
  if (size.resized) build.report.add('frames-resized', from)
  const roots =
    boxProps || size.resized
      ? [
          boxAround(build, name, { x: 0, y: 0, width: place.width, height: place.height, rotation: 0 }, pieces, {
            ...(boxProps ?? {}),
            constraints: { horizontal: 'leftRight', vertical: 'topBottom' },
          }),
        ]
      : pieces
  const trimmed = name.trim().slice(0, MAX_FRAME_NAME).trim()
  return {
    name: trimmed || 'Frame',
    figmaId: from.id,
    x: place.x,
    y: place.y,
    width: size.width,
    height: size.height,
    fills: [],
    layers: treeOf(build, roots),
    figmaIds: build.figmaIds,
  }
}

/**
 * A Figma frame's size as a frame's: rounded to whole pixels, then each side within the sizes a
 * frame can be, then the shorter side grown until the frame is within the longest ratio.
 */
function frameSize(width: number, height: number) {
  const w = Math.round(width)
  const h = Math.round(height)
  const { minSide, maxSide, maxRatio } = SIZE_LIMITS
  let fw = Math.min(maxSide, Math.max(minSide, w))
  let fh = Math.min(maxSide, Math.max(minSide, h))
  if (fw > fh * maxRatio) fh = Math.ceil(fw / maxRatio)
  else if (fh > fw * maxRatio) fw = Math.ceil(fh / maxRatio)
  return { width: fw, height: fh, rounded: w !== width || h !== height, resized: fw !== w || fh !== h }
}

/** Whether a frame has what a Dazbee frame can't carry: strokes, corners, effects, opacity, a blend mode or auto layout. */
function carriesBoxProps(fields: FigmaFields): boolean {
  const shows = (paint: unknown) => record(paint) !== undefined && bool(field(paint, 'visible')) !== false
  const corners = cornersOf(fields)
  return (
    (list(field(fields, 'strokes')).some(shows) && num(field(fields, 'strokeWeight')) !== 0) ||
    (typeof corners === 'number' ? corners > 0 : corners.some((r) => r > 0)) ||
    list(field(fields, 'effects')).some(shows) ||
    (num(field(fields, 'opacity')) ?? 1) < 1 ||
    !PLAIN_BLENDS.has(str(field(fields, 'blendMode')) ?? 'PASS_THROUGH') ||
    laysOut(fields)
  )
}
