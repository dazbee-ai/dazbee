// What the glass bar above a picked AI frame shows: whether the frame is one, what it can do now (its brief's AI
// actions, or "Working…" while it waits or is being made editable), where the bar sits over the stage, what a hover
// on an AI action says it takes, and each estimate asked once per action and mode while a design is open.
import type { AiEstimate, AiFeature, AiFrameView, AiMode, DesignAi } from '@dazbee/schema'

import { format, type Messages } from '@/lib/i18n/index.ts'

/** A picked AI frame as the bar shows it: its frame as last read, its brief's mode, and whether it is working. */
export interface GlassFrame {
  frame: AiFrameView
  /** The mode of the frame's brief, which its AI actions run in; Fast for a frame of no brief. */
  mode: AiMode
  /** Whether More like this is offered: the frame is a draft of a brief and shows its picture. */
  moreLike: boolean
  /** While it waits for its picture or is being made editable, its AI actions are off. */
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

/** Pixels the bar keeps from the frame's label, and from the stage's edges and the top islands. */
const GAP = 8

/** The picked frame `frameId` as the bar shows it; null when it isn't an AI frame of the design, as a copy isn't. */
export function glassFrame(ai: DesignAi | null, frameId: string | null): GlassFrame | null {
  const frame = frameId === null ? undefined : ai?.frames.find((f) => f.frameId === frameId)
  if (!ai || !frame) return null
  const brief = ai.briefs.find((b) => b.id === frame.briefId)
  const working = frame.state === 'waiting' || frame.state === 'layering'
  return {
    frame,
    mode: brief?.mode ?? 'fast',
    moreLike: Boolean(brief) && !working && frame.state !== 'failed',
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
