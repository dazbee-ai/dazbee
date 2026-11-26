// A frame's label on the stage: its name and, where it has room, its size, lit while the frame is
// picked, holds the selection or the text typed into, or is lit from outside the stage.
import type { EditorSelection } from '../selection.ts'
import type { EditorTyping } from '../text/typing.ts'
import type { Camera } from './camera.ts'
import { type Frame, labelBox } from './frames.ts'
import { px } from './rulers.ts'

/** What a frame's label reads: the selection, the text typed into and the camera. */
export interface FrameLabelDeps {
  selection: Pick<EditorSelection, 'current' | 'pickedFrame' | 'litFrame' | 'renamingFrame'>
  typing: Pick<EditorTyping, 'editing'>
  camera: Camera
}

/** Screen pixels a frame's label needs to show the frame's size beside its name. */
const SIZE_LABEL_WIDTH = 120

export function frameLabel(frame: Frame, { selection, typing, camera }: FrameLabelDeps) {
  // The page's rename field stands in the label's place.
  if (selection.renamingFrame() === frame.id) return null
  const label = document.createElement('div')
  label.className = 'frame-label'
  label.dataset.frame = frame.id
  if (
    selection.current()?.some((layer) => layer.frameId === frame.id) ||
    typing.editing()?.frameId === frame.id ||
    selection.pickedFrame() === frame.id
  )
    label.dataset.active = ''
  else if (selection.litFrame() === frame.id) label.dataset.lit = ''
  // A frame running off the stage's start keeps its label in view, along the part still showing;
  // a narrow frame keeps its name, cut short, and drops its size; only a frame off the stage has none.
  const box = labelBox(frame, camera)
  if (!box) return null
  const { width } = box
  Object.assign(label.style, { left: px(box.x), top: px(box.y), width: px(width) })
  const name = document.createElement('span')
  name.className = 'frame-name'
  name.textContent = frame.name
  label.append(name)
  if (width >= SIZE_LABEL_WIDTH) {
    const size = document.createElement('span')
    size.className = 'frame-size'
    size.textContent = `${frame.width} × ${frame.height}`
    label.append(size)
  }
  return label
}
