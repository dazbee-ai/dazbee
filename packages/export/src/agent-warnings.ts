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

/**
 * Where an agent batch's warnings take their fonts from: an agent tab, which loads the faces of the
 * families a step uses after the step.
 */
export interface WarningFonts {
  /** Settles once the files of every face the design draws its text in are here, or failed to come. */
  fontsLoaded(): Promise<void>
  /** The fonts, images and brand kit values there are now. */
  bytes(): ResourceBytes
}

/** The warnings for the layers an agent batch touched; when those could not be read, none, and `warningsError` says why. */
export interface AgentBatchWarnings {
  warnings: AgentWarning[]
  warningsError?: string
}

/** What came of an agent's batch, with the warnings for the layers it touched. */
export type AgentBatchWarned = AgentBatchResult & AgentBatchWarnings

/** What came of an agent's batch, with the warnings for the layers it touched to come once its fonts are here. */
export type AgentBatchRun = AgentBatchResult & { warned: Promise<AgentBatchWarnings> }

type TextLayer = Extract<SceneLayer, { type: 'text' }>

/** A design's layers and frames as they were before a batch. */
interface Before {
  nodes: Readonly<Record<string, Layer>>
  frames: Readonly<Record<string, unknown>>
}

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
 * Runs `steps` as runAgentBatch does, as one undo step, all or nothing, and gives what came of it at
 * once. Its warnings come once `fonts` has loaded the faces the design draws its text in: of what
 * the batch touched, as frameWarnings tells it with the fonts there are then, in the design's order
 * of frames, read from the session's design then, which holds what fitting those fonts changed. A
 * layer the batch didn't touch is not warned of, even if another tab changed it meanwhile. A batch
 * not kept has no warnings. `warned` never rejects: a check that fails gives `warningsError`, so the
 * caller still learns what the batch wrote.
 */
export function runAgentBatchWithWarnings(
  ck: CanvasKit,
  session: Session,
  steps: readonly AgentStep[],
  fonts: WarningFonts,
  cache?: ResourceCache,
): AgentBatchRun {
  // The design is live, but its layers and frames are replaced, never changed, so these keep it as it was.
  const design = session.design()
  const before: Before = { nodes: { ...design.nodes }, frames: { ...design.frames } }
  const result = runAgentBatch(session, steps)
  if (!result.kept) return { ...result, warned: Promise.resolve({ warnings: [] }) }
  return { ...result, warned: batchWarnings(ck, session, before, fonts, cache) }
}

/** What came of an agent's batch, with its warnings, once they have come. */
export async function whenWarned({ warned, ...result }: AgentBatchRun): Promise<AgentBatchWarned> {
  return { ...result, ...(await warned) }
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

/**
 * The warnings for what a kept batch touched, from `before` to the session's design as the batch left
 * it, read from the session's design once `fonts` has loaded the faces it draws its text in.
 */
async function batchWarnings(
  ck: CanvasKit,
  session: Session,
  before: Before,
  fonts: WarningFonts,
  cache: ResourceCache | undefined,
): Promise<AgentBatchWarnings> {
  let owned: ResourceCache | undefined
  try {
    const touched = touchedLayers(session.design(), before)
    await fonts.fontsLoaded()
    const design = session.design()
    const bytes = fonts.bytes()
    owned = cache ?? resourceCache(ck)
    const resources = owned
    const warnings = Object.keys(design.frames).flatMap((frameId) => {
      const ids = touched.get(frameId)
      if (ids === undefined) return []
      return frameWarnings(ck, design, frameId, bytes, {
        ...(ids === 'all' ? {} : { layerIds: ids }),
        cache: resources,
      })
    })
    return { warnings }
  } catch (error) {
    return { warnings: [], warningsError: error instanceof Error ? error.message : String(error) }
  } finally {
    if (!cache) owned?.delete()
  }
}

/**
 * The layers a change from `before` to `design` touched, by frame, or
 * `all` of a frame. A layer added or changed touches itself and the layers inside it; one taken
 * out of a group, box or frame, moved or removed, touches the layers left there. Inside a box that
 * lays out its layers, every layer of the outermost such box is touched, since they may have moved.
 * A frame changed touches every layer of it.
 */
function touchedLayers(design: Design, before: Before): Map<string, Set<string> | 'all'> {
  const touched = new Map<string, Set<string> | 'all'>()
  for (const [frameId, frame] of Object.entries(design.frames))
    if (!sameValue(ownValue(before.frames, frameId), frame)) touched.set(frameId, 'all')
  const touch = (from: string) => {
    const frameId = frameIdOf(design, from)
    if (frameId === undefined) return
    const ids = touched.get(frameId) ?? new Set<string>()
    if (ids === 'all') return
    const top = outermostLaidOut(design, from)
    for (const each of [top, ...descendants(design, top)]) if (each !== frameId) ids.add(each)
    touched.set(frameId, ids)
  }
  for (const id of new Set([...Object.keys(before.nodes), ...Object.keys(design.nodes)])) {
    const node = ownValue(design.nodes, id)
    const was = ownValue(before.nodes, id)
    if (sameValue(was, node)) continue
    if (node) touch(id)
    if (was && was.parentId !== node?.parentId) touch(was.parentId)
  }
  return touched
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
