// What an agent is told about a frame it made or changed: plain sentences, each about one layer,
// for what won't look as designed. It reads the design as the export draws it, and writes nothing.
import type { CanvasKit } from '@dazbee/canvaskit'
import {
  type AgentBatchResult,
  type AgentStep,
  boundsOf,
  centreOf,
  cornersOf,
  type Point,
  runAgentBatch,
  sameValue,
  type Session,
  turn,
} from '@dazbee/doc'
import {
  familiesOf,
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
import { type Design, isNineBySixteen, type Rect, SAFE_ZONES, safeZoneBands } from '@dazbee/schema'

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

/** How far laid-out lines may pass a fixed box's height before they overflow it, as fitting text allows. */
const OVERFLOW_SLACK = 0.01

/**
 * What in frame `frameId` won't look as designed, layer by layer back to front. In a text: a
 * family `bytes` has no file for, so it draws in a fallback font; characters no font has; lines
 * taller than a fixed box; lines past its `maxLines`, cut off; on a 9:16 frame, its box inside a
 * platform's safe-zone edge. Any layer: everything it draws, shadows included, wholly outside the
 * frame, told of only for the outermost such layer checked. Hidden layers are not checked.
 */
export function frameWarnings(
  ck: CanvasKit,
  design: Design,
  frameId: string,
  bytes: ResourceBytes,
  { layerIds, cache }: AgentWarningOptions = {},
): AgentWarning[] {
  const frame = Object.hasOwn(design.frames, frameId) ? design.frames[frameId] : undefined
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
      frame,
      nameOf: (id) => design.nodes[id]?.name || id,
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
 * batch touched, as frameWarnings tells it: the layers it added or changed, each in its frame, and
 * every layer of a frame it changed. A batch not kept has no warnings. It writes nothing past what
 * the batch writes.
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
  for (const [id, node] of Object.entries(design.nodes)) {
    if (sameValue(ownValue(nodesBefore, id), node)) continue
    const frameId = frameOf(design, id)
    if (frameId === undefined) continue
    const ids = touched.get(frameId) ?? new Set<string>()
    if (ids !== 'all') touched.set(frameId, ids.add(id))
  }
  const warnings = Object.keys(design.frames).flatMap((frameId) => {
    const ids = touched.get(frameId)
    if (ids === undefined) return []
    return frameWarnings(ck, design, frameId, bytes, {
      ...(ids === 'all' ? {} : { layerIds: ids }),
      ...(cache ? { cache } : {}),
    })
  })
  return { ...result, warnings }
}

/** Tells of a layer that draws nothing inside its frame; whether it did. */
function toldOutside({ ck, resources, frame, nameOf, warn }: Check, layer: SceneLayer, turns: readonly Turn[]) {
  const reach = layerReach(ck, layer, resources)
  if (overlaps(placed(cornersOf({ ...reach, rotation: 0 }), turns), { x: 0, y: 0, ...frame })) return false
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
    for (const family of new Set(familiesOf(layer)))
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
    if (props.boxMode === 'fixed' && laid.height > props.height + OVERFLOW_SLACK)
      warn(
        'overflow',
        `Text "${name}" overflows its fixed box: its lines are ${Math.ceil(laid.height)} px tall in a box ${props.height} px tall.`,
      )
    const paragraphs = props.text.split('\n').length
    if (laid.blocks.length < paragraphs || laid.blocks.some((block) => block.paragraph.didExceedMaxLines()))
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

/** Whether two rects share some area. */
function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

/** The platforms whose safe-zone edge `box` is inside, on a 9:16 frame; none on another shape. */
function coveringPlatforms(frame: { width: number; height: number }, box: Rect): string[] {
  if (!isNineBySixteen(frame.width, frame.height)) return []
  return SAFE_ZONES.filter(({ platform }) =>
    safeZoneBands(frame.width, frame.height, platform).some((band) => overlaps(band, box)),
  ).map(({ platform }) => platform)
}

/** Names as a sentence lists them: `A`, `A and B`, `A, B and C`. */
function listed(names: readonly string[]): string {
  return names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
}

/** A record's own value under `key`, never one its prototype gives. */
function ownValue<T>(records: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.hasOwn(records, key) ? records[key] : undefined
}

/** The frame layer `id` is in; none when its chain of parents ends elsewhere. */
function frameOf(design: Design, id: string): string | undefined {
  let up = ownValue(design.nodes, id)?.parentId
  while (up !== undefined && !Object.hasOwn(design.frames, up)) up = ownValue(design.nodes, up)?.parentId
  return up
}
