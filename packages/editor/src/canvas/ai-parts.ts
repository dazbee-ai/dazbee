// The AI frames' parts over the stage: a quiet sheen over each frame in view that waits for its AI picture, so the
// plain colour it waits in reads as on its way. Only the overlay draws it, so no export does.
import type { Rect } from '@dazbee/schema'

import type { Frame } from './frames.ts'

/** A sheen over each frame given whose id is among `waiting`, over the whole frame, placed on the stage by `placeBox`. */
export function sheenParts(
  frames: readonly Frame[],
  placeBox: (el: HTMLElement, frame: Frame, box: Rect) => void,
  waiting: ReadonlySet<string>,
): HTMLElement[] {
  return frames.flatMap((frame) => {
    if (!waiting.has(frame.id)) return []
    const el = document.createElement('div')
    el.className = 'ai-waiting'
    el.dataset.frame = frame.id
    placeBox(el, frame, { x: 0, y: 0, width: frame.width, height: frame.height })
    return [el]
  })
}
