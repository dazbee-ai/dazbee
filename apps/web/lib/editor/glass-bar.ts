// What the glass bar above a picked AI frame shows: whether the frame is one, what it can do now (its brief's AI
// actions, or "Working…" while it waits, is refined or is being made editable), where the bar sits over the stage, what a hover
// on an AI action says it takes, and each estimate asked once per action and mode while a design is open.
import {
  type AiEstimate,
  type AiFeature,
  type AiFrameView,
  type AiJobView,
  type AiMode,
  type DesignAi,
  pictureLayerOf,
} from '@dazbee/schema'

import { format, type Messages } from '@/lib/i18n/index.ts'

import { refining } from './refine.ts'

/** A picked AI frame as the bar shows it: its frame as last read, its brief's mode, and whether it is working. */
export interface GlassFrame {
  frame: AiFrameView
  /** The mode of the frame's brief, which its AI actions run in; Fast for a frame of no brief. */
  mode: AiMode
  /** Whether More like this is offered: the frame is a draft of a brief and shows its picture. */
  moreLike: boolean
  /** Whether Refine with AI is offered: the frame shows its picture or is editable. */
  refine: boolean
  /** While it waits for its picture, is refined or is being made editable, its AI actions are off. */
  working: boolean
}

/** Where the bar goes on the stage, its top start corner in pixels from the stage's. */
export interface GlassPlace {
  left: number
  top: number
}

/** The estimates asked for while a design is open, by its editor, then action and mode: each is asked once. */
export interface Estimates {
  /** The estimate of `action` in `mode` for `holder`: asked with `ask` the first time, then the same promise. */
  get(holder: object, action: AiFeature, mode: AiMode, ask: () => Promise<AiEstimate>): Promise<AiEstimate>
}

/**
 * What Make editable offers on a frame: to start it on a picture (`make`), Back to picture on one showing its layers
 * (`back`), or to show its layers again over a picture it was made from (`again`, with those layers); null while it
 * works or on a frame with no picture.
 */
export type EditableAction =
  { kind: 'make' } | { kind: 'back'; layerIds: string[] } | { kind: 'again'; layerIds: string[] }

/** How long the layer split may take before the bar says it is warming up, in ms: its cold start is 50–55 s. */
export const WARMING_MS = 25_000

/** Pixels the bar keeps from the frame's label, and from the stage's edges and the top islands. */
const GAP = 8

/** The picked frame `frameId` as the bar shows it; null when it isn't an AI frame of the design, as a copy isn't. */
export function glassFrame(ai: DesignAi | null, frameId: string | null): GlassFrame | null {
  const frame = frameId === null ? undefined : ai?.frames.find((f) => f.frameId === frameId)
  if (!ai || !frame) return null
  const brief = ai.briefs.find((b) => b.id === frame.briefId)
  const working = frame.state === 'waiting' || frame.state === 'layering' || refining(ai, frame.frameId)
  return {
    frame,
    mode: brief?.mode ?? 'fast',
    moreLike: Boolean(brief) && !working && frame.state !== 'failed',
    refine: !working && (frame.state === 'arrived' || frame.state === 'editable'),
    working,
  }
}

/**
 * Where the bar of `width` × `height` goes: centred over the frame spanning `frame` across the stage, above its
 * label, and above the title of the frame's section when the bar would cover it there; kept inside the stage's sides
 * and below the top islands.
 */
export function glassPlace({
  frame,
  label,
  title,
  width,
  height,
  room,
  under,
}: {
  /** The frame's left and right edges on the stage. */
  frame: { left: number; right: number }
  /** The top of the frame's label on the stage. */
  label: number
  /** Where the title of the frame's section is on the stage, if it is drawn. */
  title?: { x: number; y: number; width: number; height: number } | null
  width: number
  height: number
  /** The stage's width. */
  room: number
  /** The bottom of the top islands on the stage. */
  under: number
}): GlassPlace {
  const centre = (frame.left + frame.right) / 2
  const left = Math.round(Math.min(Math.max(centre - width / 2, GAP), Math.max(GAP, room - width - GAP)))
  let top = label - height - GAP
  const covers =
    title &&
    left < title.x + title.width &&
    left + width > title.x &&
    top < title.y + title.height &&
    top + height > title.y
  if (covers) top = title.y - height - GAP
  return { left, top: Math.round(Math.max(top, under + GAP)) }
}

/**
 * What a hover on an AI action says: its share of the workspace's AI and about how long it takes, the time alone for
 * a workspace with no allowance; the action's name while neither is known.
 */
export function estimateWords(estimate: AiEstimate | null, name: string, t: Messages['editor']['glass']): string {
  if (!estimate) return name
  const time =
    estimate.seconds < 90
      ? format(t.seconds, { n: estimate.seconds })
      : format(t.minutes, { n: Math.round(estimate.seconds / 60) })
  const { share } = estimate
  if (share === null) return format(t.estimateTime, { name, time })
  return share === 'under-1'
    ? format(t.estimateUnder, { name, time })
    : format(t.estimate, { name, percent: share, time })
}

export function estimates(): Estimates {
  const kept = new WeakMap<object, Map<string, Promise<AiEstimate>>>()
  return {
    get(holder, action, mode, ask) {
      const own = kept.get(holder) ?? new Map<string, Promise<AiEstimate>>()
      kept.set(holder, own)
      const key = `${action}/${mode}`
      const asked =
        own.get(key) ??
        ask().catch((error: unknown) => {
          // A failed ask is asked again next time.
          own.delete(key)
          throw error
        })
      own.set(key, asked)
      return asked
    },
  }
}

/** The app's estimates of AI actions. */
export const ESTIMATES = estimates()

/**
 * What Make editable offers on AI frame `frame` of `design`: the layers made from its picture are the frame's layers
 * whose ids come from its layering job; Back to picture while its picture is hidden, Make editable again over them
 * while it shows, else Make editable on a frame that shows its picture.
 */
export function editableAction(
  frame: Pick<AiFrameView, 'frameId' | 'state' | 'jobId'>,
  design: { nodes: Readonly<Record<string, { parentId: string; props: { visible?: boolean } }>> },
): EditableAction | null {
  if (frame.state !== 'arrived' && frame.state !== 'editable') return null
  const picture = design.nodes[pictureLayerOf(frame.frameId)]
  if (!picture) return null
  const layerIds =
    frame.state === 'editable'
      ? Object.entries(design.nodes)
          .filter(([id, node]) => node.parentId === frame.frameId && id.startsWith(`${frame.jobId}-`))
          .map(([id]) => id)
      : []
  if (layerIds.length === 0) return { kind: 'make' }
  return picture.props.visible === false ? { kind: 'back', layerIds } : { kind: 'again', layerIds }
}

/** Whether a layering job's split is warming up: it has run `WARMING_MS` and made no layers yet. */
export function warmingUp(job: Pick<AiJobView, 'state' | 'calls' | 'createdAt'> | undefined, now: number): boolean {
  if (!job || (job.state !== 'running' && job.state !== 'waiting')) return false
  const split = job.calls.some((c) => c.function === 'layer-split' && c.state === 'done')
  return !split && now - Date.parse(job.createdAt) >= WARMING_MS
}
