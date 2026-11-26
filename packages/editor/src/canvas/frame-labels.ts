// A frame's label on the stage: its name, the frame's star after it, and, where it has room, its
// size; lit while the frame is picked, holds the selection or the text typed into, or is lit from
// outside the stage. A starred frame's star always shows, filled; an unstarred one's shows hollow
// only while the label offers it, as its row is hovered.
import type { EditorSelection } from '../selection.ts'
import type { EditorTyping } from '../text/typing.ts'
import type { Camera } from './camera.ts'
import { type Frame, labelBox } from './frames.ts'
import { px } from './rulers.ts'

/** What a frame's label reads: the selection, the text typed into, the camera, and the frame whose label offers its star. */
export interface FrameLabelDeps {
  selection: Pick<EditorSelection, 'current' | 'pickedFrame' | 'litFrame' | 'renamingFrame'>
  typing: Pick<EditorTyping, 'editing'>
  camera: Camera
  /** The frame whose label shows its hollow star, as the pointer hovers its row in a tab that may edit; null with none. */
  starOffered: string | null
}

/** Screen pixels a frame's label needs to show the frame's size beside its name. */
const SIZE_LABEL_WIDTH = 120
const SVG = 'http://www.w3.org/2000/svg'
/** A five-pointed star in a 12 px square, drawn filled or as its outline by the stylesheet. */
const STAR_PATH = 'M6 1.3 7.23 4.6l3.53.16L8 6.95l.94 3.4L6 8.4l-2.94 1.95.94-3.4-2.76-2.19 3.53-.16z'

export function frameLabel(frame: Frame, { selection, typing, camera, starOffered }: FrameLabelDeps) {
  // The page's rename field stands in the label's place.
  if (selection.renamingFrame() === frame.id) return null
  const label = document.createElement('div')
  label.className = 'frame-label'
  label.dataset.frame = frame.id
  const picked = selection.pickedFrame() === frame.id
  if (
    selection.current()?.some((layer) => layer.frameId === frame.id) ||
    typing.editing()?.frameId === frame.id ||
    picked
  )
    label.dataset.active = ''
  else if (selection.litFrame() === frame.id) label.dataset.lit = ''
  // A picked frame shows by its name alone, in the accent.
  if (picked) label.dataset.picked = ''
  // A frame running off the stage's start keeps its label in view, along the part still showing;
  // a narrow frame keeps its name, cut short, and drops its size; only a frame off the stage has none.
  const box = labelBox(frame, camera)
  if (!box) return null
  const { width } = box
  Object.assign(label.style, { left: px(box.x), top: px(box.y), width: px(width) })
  // The name and the star stay on the label's first line together, the name cut short before the star goes.
  const title = document.createElement('span')
  title.className = 'frame-title'
  const name = document.createElement('span')
  name.className = 'frame-name'
  name.textContent = frame.name
  title.append(name)
  if (frame.starred || starOffered === frame.id) title.append(star(frame))
  label.append(title)
  if (width >= SIZE_LABEL_WIDTH) {
    const size = document.createElement('span')
    size.className = 'frame-size'
    size.textContent = `${frame.width} × ${frame.height}`
    label.append(size)
  }
  return label
}

/** The star after a frame's name: filled for a starred frame, hollow for one that isn't. */
function star(frame: Frame) {
  const el = document.createElementNS(SVG, 'svg')
  el.setAttribute('class', 'frame-star')
  el.setAttribute('viewBox', '0 0 12 12')
  el.setAttribute('aria-hidden', 'true')
  el.setAttribute('data-frame', frame.id)
  if (frame.starred) el.setAttribute('data-starred', '')
  const path = document.createElementNS(SVG, 'path')
  path.setAttribute('d', STAR_PATH)
  el.append(path)
  return el
}
