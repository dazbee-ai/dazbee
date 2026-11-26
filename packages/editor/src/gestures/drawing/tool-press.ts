// A press on the stage with a drawing tool: the Frame and Section tools, a shape, the image armed
// from Assets, the pen and the text tool each start what they draw; the Select and Hand tools leave
// the press to the pointer.
import type { Point } from '@dazbee/schema'

import { toWorld } from '../../canvas/camera.ts'
import type { Frame } from '../../canvas/frames.ts'
import type { EditorView } from '../../canvas/view.ts'
import type { EditorTools } from '../../tools.ts'
import type { PointerInput } from '../inputs.ts'
import type { EditorPen } from '../pen/pen.ts'
import { isDrawTool } from './draw-tools.ts'
import type { DrawingDrag, EditorDrawing } from './drawing.ts'

/** What a drawing tool's press reads and starts. */
export interface ToolPressDeps {
  view: Pick<EditorView, 'camera'>
  tools: Pick<EditorTools, 'tool' | 'setTool' | 'imageToPlace'>
  drawing: Pick<EditorDrawing, 'pressShape' | 'pressImage' | 'pressText' | 'pressFrame' | 'pressSection'>
  pen: Pick<EditorPen, 'down'>
}

/**
 * A press of the main button at `screen`, on the frame and point `at`, with the tool in use: the drag
 * a drawing tool starts, if any; null for a tool that leaves the press to the pointer.
 */
export function toolPress(
  e: PointerInput,
  screen: Point,
  at: { frame: Frame; p: Point } | null,
  { view, tools, drawing, pen }: ToolPressDeps,
): { drag: DrawingDrag | null } | null {
  const tool = tools.tool()
  // The Frame tool draws a frame anywhere on the stage, not only on a frame, and so does the Section tool its box.
  if (tool === 'frame') {
    return { drag: drawing.pressFrame(e, toWorld(view.camera(), screen)) }
  }
  if (tool === 'section') return { drag: drawing.pressSection(e, toWorld(view.camera(), screen)) }
  if (isDrawTool(tool)) {
    const drag = at && drawing.pressShape(e, tool, at)
    return { drag }
  }
  // An image armed from Assets goes where a press on a frame lands; a press off every frame places
  // nothing and puts the select tool back.
  if (tool === 'image') {
    const imageToPlace = tools.imageToPlace()
    if (at && imageToPlace) return { drag: drawing.pressImage(e, at, imageToPlace) }
    else tools.setTool('select')
    return { drag: null }
  }
  if (tool === 'pen') {
    if (at) pen.down(e, at)
    return { drag: null }
  }
  if (tool === 'text') {
    return { drag: at ? drawing.pressText(e, at) : null }
  }
  return null
}
