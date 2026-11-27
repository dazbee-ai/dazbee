// The AI frames' parts over the stage: a quiet sheen over each frame in view that waits for its AI picture, so the
// plain colour it waits in reads as on its way; and, over a frame whose split pieces the matchers are working on, a
// veil with the pieces lifting from it one after another and settling back. Only the overlay draws them, so no
// export does.
import type { Rect } from '@dazbee/schema'

import type { LiftedFrame } from '../ai/layering-finish.ts'
import type { Frame } from './frames.ts'

/** How long a piece takes to lift and settle back, in ms; the stylesheet's `ai-lift` runs as long. */
export const LIFT_MS = 2600
/** How much later each piece lifts than the one under it, in ms. */
const LIFT_STAGGER_MS = 140
/** The most steps a piece lifts by: the pieces above that many lift as high as it. */
const MOST_LIFT = 8
/** A step of lift is this share of the frame's height on the screen, and at least and at most this many pixels. */
const LIFT_STEP = 1 / 150
const LEAST_STEP_PX = 1
const MOST_STEP_PX = 4

/** Each lifting piece's picture element, kept while its frame lifts, so the overlay drawn again loads no picture twice. */
const pictures = new WeakMap<object, HTMLImageElement>()

/**
 * A sheen over each frame given whose id is among `waiting` and not among `lifting`, over the whole frame, placed on
 * the stage by `placeBox`.
 */
export function sheenParts(
  frames: readonly Frame[],
  placeBox: (el: HTMLElement, frame: Frame, box: Rect) => void,
  waiting: ReadonlySet<string>,
  lifting: ReadonlySet<string> = new Set(),
): HTMLElement[] {
  return frames.flatMap((frame) => {
    if (!waiting.has(frame.id) || lifting.has(frame.id)) return []
    const el = document.createElement('div')
    el.className = 'ai-waiting'
    el.dataset.frame = frame.id
    placeBox(el, frame, { x: 0, y: 0, width: frame.width, height: frame.height })
    return [el]
  })
}

/**
 * The pieces of each frame given that is among `lifted`: a veil over the frame, then each piece's picture at its box,
 * bottom first, a piece higher in the frame lifting higher and a little later, by steps that follow the frame's size
 * on the screen. Each piece's lift is `now` ms into its run, so pieces drawn again keep their pace.
 */
export function liftParts(
  frames: readonly Frame[],
  placeBox: (el: HTMLElement, frame: Frame, box: Rect) => void,
  lifted: readonly LiftedFrame[],
  now: number,
): HTMLElement[] {
  return frames.flatMap((frame) => {
    const own = lifted.find((one) => one.frameId === frame.id)
    if (!own) return []
    const veil = document.createElement('div')
    veil.className = 'ai-lift-veil'
    veil.dataset.frame = frame.id
    placeBox(veil, frame, { x: 0, y: 0, width: frame.width, height: frame.height })
    const shown = Number.parseFloat(veil.style.height) || 0
    const step = Math.min(MOST_STEP_PX, Math.max(LEAST_STEP_PX, shown * LIFT_STEP))
    const pieces = own.pieces.map((piece, n) => {
      const el = pictures.get(piece) ?? pictureOf(piece.url)
      pictures.set(piece, el)
      // The custom property first, as the whole inline style: the delay and the box are set on it after.
      el.setAttribute('style', `--lift: ${Math.round(Math.min(n + 1, MOST_LIFT) * step)}px`)
      el.style.animationDelay = `${-(((now - n * LIFT_STAGGER_MS) % LIFT_MS) + LIFT_MS) % LIFT_MS}ms`
      placeBox(el, frame, piece.box)
      return el
    })
    return [veil, ...pieces]
  })
}

/** A lifting piece's picture element, showing the picture at `url`. */
function pictureOf(url: string): HTMLImageElement {
  const el = document.createElement('img')
  el.className = 'ai-lift'
  el.src = url
  el.alt = ''
  el.draggable = false
  return el
}
