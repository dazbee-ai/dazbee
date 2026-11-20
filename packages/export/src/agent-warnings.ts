// What an agent is told about a frame it made or changed: plain sentences, each about one layer,
// for what won't look as designed, read from the design as the export draws it. The checks write
// nothing; an agent's batch run here writes only through runAgentBatch.
import type { CanvasKit } from '@dazbee/canvaskit'
import {
  type AgentBatchResult,
  type AgentStep,
  boundsOf,
  centreOf,
  cornersOf,
  descendants,
  frameIdOf,
  intersects,
  type Point,
  runAgentBatch,
  sameValue,
  type Session,
  turn,
} from '@dazbee/doc'
import {
  drawnFamilies,
  layerReach,
  layoutText,
  missingGraphemes,
  render,
  type ResourceBytes,
  type ResourceCache,
  resourceCache,
  type Resources,
  type SceneLayer,
  textMeasure,
} from '@dazbee/renderer'
import { type Design, type Layer, type Rect, SAFE_ZONES, safeZoneBands } from '@dazbee/schema'

/** What a warning is about. */
export type AgentWarningKind =
  'missingFont' | 'missingCharacters' | 'overflow' | 'pastMaxLines' | 'outsideFrame' | 'safeZone'

/** One thing in a frame that won't look as designed, as a sentence about the layer it is in. */
export interface AgentWarning {
  layerId: string
  kind: AgentWarningKind
  message: string
}

/** Which layers to check, and the resource cache to draw with. */
export interface AgentWarningOptions {
  /** The layers to check, at any depth; every layer the frame shows when left out. */
  layerIds?: Iterable<string>
  cache?: ResourceCache
}

/** What came of an agent's batch, with the warnings for the layers it touched. */
export type AgentBatchWarned = AgentBatchResult & { warnings: AgentWarning[] }

type TextLayer = Extract<SceneLayer, { type: 'text' }>

/** A container's rotation, which turns the layers inside it about the container's centre. */
interface Turn {
  about: Point
  degrees: number
}

/** What every check of one frame reads. */
interface Check {
  ck: CanvasKit
  resources: Resources
  /** The families `bytes` has files for. */
  have: ReadonlySet<string>
  frame: { name: string; width: number; height: number }
  nameOf: (id: string) => string
  warn: (layerId: string, kind: AgentWarningKind, message: string) => void
}

/** How far laid-out lines may pass a fixed box before they overflow it, as fitting text allows. */
const OVERFLOW_SLACK = 0.01

/**
 * What in frame `frameId` won't look as designed, layer by layer back to front. In a text: a
 * family `bytes` has no file for, so it draws in a fallback font; characters no font has; lines
 * taller than a fixed box, or a word wider than it; lines past its `maxLines`, cut off; on a 9:16
 * frame, its box inside a platform's safe-zone edge. Any layer: everything it draws, shadows
 * included, wholly outside the frame, told of only for the outermost such layer checked. Hidden
 * layers are not checked.
 */
export function frameWarnings(
  ck: CanvasKit,
  design: Design,
  frameId: string,
  bytes: ResourceBytes,
  { layerIds, cache }: AgentWarningOptions = {},
): AgentWarning[] {
  const frame = ownValue(design.frames, frameId)
  if (!frame) throw new Error(`no frame "${frameId}"`)
  const wanted = layerIds === undefined ? undefined : new Set(layerIds)
  const owned = cache ?? resourceCache(ck)
  try {
    const resources = owned.resources(bytes)
    const scene = render(design, frameId, undefined, textMeasure(ck, resources), bytes.variables)
    const warnings: AgentWarning[] = []
    const check: Check = {
      ck,
      resources,
      have: new Set(bytes.fonts.map((font) => font.family)),
      frame: { name: frame.name, width: frame.width, height: frame.height },
      nameOf: (id) => ownValue(design.nodes, id)?.name || id,
      warn: (layerId, kind, message) => warnings.push({ layerId, kind, message }),
    }
    const walk = (layers: readonly SceneLayer[], turns: readonly Turn[], outsideTold: boolean) => {
      for (const layer of layers) {
        const asked = !wanted || wanted.has(layer.id)
        const told = outsideTold || (asked && toldOutside(check, layer, turns))
        if (asked && layer.type === 'text') textWarnings(check, layer, turns)
        const { rotation } = layer.props
        const inside = rotation === 0 ? turns : [...turns, { about: centreOf(layer.props), degrees: rotation }]
        walk(layer.children, inside, told)
      }
    }
    walk(scene.layers, [], false)
    return warnings
  } finally {
    if (!cache) owned.delete()
  }
}

/**
 * Runs `steps` as runAgentBatch does, as one undo step, all or nothing, then warns of what the
 * batch touched, as frameWarnings tells it, in the design's order of frames. A layer it added,
 * changed or took out touches the layers inside it, and, in a box that lays out its layers, every
 * layer of the outermost such box, whose layers it may have moved; a frame it changed touches
 * every layer of it. A batch not kept has no warnings.
 */
export function runAgentBatchWithWarnings(
  ck: CanvasKit,
  session: Session,
  steps: readonly AgentStep[],
  bytes: ResourceBytes,
  cache?: ResourceCache,
): AgentBatchWarned {
  // The design is live, but its layers and frames are replaced, never changed, so these keep it as it was.
  const before = session.design()
  const nodesBefore = { ...before.nodes }
  const framesBefore = { ...before.frames }
  const result = runAgentBatch(session, steps)
  if (!result.kept) return { ...result, warnings: [] }
  const design = session.design()
  /** The layers to check in each frame, or `all` of them. */
  const touched = new Map<string, Set<string> | 'all'>()
  for (const [frameId, frame] of Object.entries(design.frames))
    if (!sameValue(ownValue(framesBefore, frameId), frame)) touched.set(frameId, 'all')
  const changed = new Set([...Object.keys(nodesBefore), ...Object.keys(design.nodes)])
  for (const id of changed) {
    const node = ownValue(design.nodes, id)
    if (sameValue(ownValue(nodesBefore, id), node)) continue
    // A layer taken out touches what held it.
    const from = node ? id : nodesBefore[id]?.parentId
    const frameId = from === undefined ? undefined : frameIdOf(design, from)
    if (from === undefined || frameId === undefined) continue
    const ids = touched.get(frameId) ?? new Set<string>()
    if (ids === 'all') continue
    const top = outermostLaidOut(design, from)
    for (const each of [top, ...descendants(design, top)]) if (each !== frameId) ids.add(each)
    touched.set(frameId, ids)
  }
  const owned = cache ?? resourceCache(ck)
  try {
    const warnings = Object.keys(design.frames).flatMap((frameId) => {
      const ids = touched.get(frameId)
      if (ids === undefined) return []
      return frameWarnings(ck, design, frameId, bytes, { ...(ids === 'all' ? {} : { layerIds: ids }), cache: owned })
    })
    return { ...result, warnings }
  } finally {
    if (!cache) owned.delete()
  }
}

/** A record's own value under `key`, never one its prototype gives. */
function ownValue<T>(records: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.hasOwn(records, key) ? records[key] : undefined
}

/** Tells of a layer that draws nothing inside its frame; whether it did. */
function toldOutside({ ck, resources, frame, nameOf, warn }: Check, layer: SceneLayer, turns: readonly Turn[]) {
  const reach = layerReach(ck, layer, resources)
  const inFrame = { x: 0, y: 0, width: frame.width, height: frame.height }
  if (intersects(placed(cornersOf({ ...reach, rotation: 0 }), turns), inFrame)) return false
  warn(
    layer.id,
    'outsideFrame',
    `Layer "${nameOf(layer.id)}" is wholly outside its frame "${frame.name}", so none of it shows.`,
  )
  return true
}

/** Tells what won't draw as designed in one text layer. */
function textWarnings(check: Check, layer: TextLayer, turns: readonly Turn[]) {
  const { ck, resources, have, nameOf } = check
  const { props } = layer
  const name = nameOf(layer.id)
  const warn = (kind: AgentWarningKind, message: string) => check.warn(layer.id, kind, message)
  const laid = layoutText(ck, props, resources)
  try {
    for (const family of new Set(drawnFamilies(layer)))
      if (!have.has(family))
        warn(
          'missingFont',
          `Text "${name}" is set in "${family}", which has no font file, so it draws in a fallback font.`,
        )
    const missing = [...new Set(laid.blocks.flatMap((block) => missingGraphemes(block)))]
    if (missing.length > 0)
      warn(
        'missingCharacters',
        `Text "${name}" has characters no font has, which draw as empty boxes: ${missing.join(' ')}`,
      )
    const paragraphs = props.text.split('\n').length
    const cut = laid.blocks.length < paragraphs || laid.blocks.some((block) => block.paragraph.didExceedMaxLines())
    // The paragraph a line limit cuts ends in an ellipsis, and then gives its whole line as its least width.
    const whole = cut ? laid.blocks.slice(0, -1) : laid.blocks
    if (props.boxMode === 'fixed' && laid.height > props.height + OVERFLOW_SLACK)
      warn(
        'overflow',
        `Text "${name}" overflows its fixed box: its lines are ${Math.ceil(laid.height)} px tall in a box ${props.height} px tall.`,
      )
    else if (
      props.boxMode === 'fixed' &&
      whole.some((block) => block.paragraph.getMinIntrinsicWidth() > block.paragraph.getMaxWidth() + OVERFLOW_SLACK)
    )
      warn('overflow', `Text "${name}" overflows its fixed box: a word is wider than the box, ${props.width} px.`)
    if (cut)
      warn('pastMaxLines', `Text "${name}" has more lines than its limit of ${props.maxLines}, so the rest is cut off.`)
  } finally {
    laid.delete()
  }
  const platforms = coveringPlatforms(check.frame, placed(cornersOf(props), turns))
  if (platforms.length > 0)
    warn(
      'safeZone',
      `Text "${name}" is inside the safe-zone edge of ${listed(platforms)}, where the platform’s own buttons and captions cover it.`,
    )
}

/** The box around `corners` once each container's rotation in `turns`, innermost first, has turned them. */
function placed(corners: readonly Point[], turns: readonly Turn[]): Rect {
  const points = corners.map((corner) => turns.reduceRight((p, { about, degrees }) => turn(p, about, degrees), corner))
  return boundsOf(points.map((p) => ({ ...p, width: 0, height: 0, rotation: 0 })))
}

/** The platforms whose safe-zone edge `box` is inside; none on a frame that isn't 9:16. */
function coveringPlatforms(frame: { width: number; height: number }, box: Rect): string[] {
  return SAFE_ZONES.filter(({ platform }) =>
    safeZoneBands(frame.width, frame.height, platform).some((band) => intersects(band, box)),
  ).map(({ platform }) => platform)
}

/** Names as a sentence lists them: `A`, `A and B`, `A, B and C`. */
function listed(names: readonly string[]): string {
  return names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
}

/** Layer `id`, or the outermost box holding it whose auto layout places the layers in it. */
function outermostLaidOut(design: Design, id: string): string {
  let top = id
  for (let up = ownValue(design.nodes, id)?.parentId; up !== undefined;) {
    const holder: Layer | undefined = ownValue(design.nodes, up)
    if (holder?.type !== 'box' || !holder.props.layout) break
    top = up
    up = holder.parentId
  }
  return top
}
