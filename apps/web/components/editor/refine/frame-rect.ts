// Where a frame is on the stage, kept current as the view moves and the frame changes, for the parts of the page
// laid beside it: the refine box under it, the versions to its right and the marks over it.
import { useEffect, useState } from 'react'

import type { Editor } from '@dazbee/editor'

/** A frame's edges on the stage, in pixels from the stage's left and top. */
export interface FrameRect {
  left: number
  top: number
  right: number
  bottom: number
}

/**
 * Where frame `frameId` is on the stage that holds `anchor`, kept current; null while a gesture runs, before `anchor`
 * is in the page, and for a frame the design hasn't.
 */
export function useFrameRect(editor: Editor, frameId: string, anchor: HTMLElement | null): FrameRect | null {
  const [rect, setRect] = useState<FrameRect | null>(null)
  useEffect(() => {
    const stage = anchor?.offsetParent as HTMLElement | null | undefined
    if (!stage) return
    const update = () => {
      const frame = editor.design().frames[frameId]
      if (!frame || editor.busy()) return setRect(null)
      const origin = stage.getBoundingClientRect()
      const start = editor.screenPoint(0, 0, frameId)
      const end = editor.screenPoint(frame.width, frame.height, frameId)
      const next = {
        left: Math.round(Math.min(start.x, end.x) - origin.left),
        top: Math.round(Math.min(start.y, end.y) - origin.top),
        right: Math.round(Math.max(start.x, end.x) - origin.left),
        bottom: Math.round(Math.max(start.y, end.y) - origin.top),
      }
      setRect((now) =>
        now && now.left === next.left && now.top === next.top && now.right === next.right && now.bottom === next.bottom
          ? now
          : next,
      )
    }
    update()
    const stop = editor.onShown(update)
    window.addEventListener('pointerup', update)
    return () => {
      stop()
      window.removeEventListener('pointerup', update)
    }
  }, [editor, frameId, anchor])
  return rect
}
