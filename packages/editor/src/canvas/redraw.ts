// The redraw pass: all a redraw does but put the pictures on the screen and build the overlay's
// elements. It brings the design as last drawn up to date, lets the selection and typing go of what
// is gone, records the pictures of the frames in view and of what a drag carries, measures the
// sections' outlines, lit where picked or a drop's target, and the connectors' curves, blue where
// picked, checks the hover,
// tells that what is shown changed, reports what it did and has the page told of layers left out.
// In a browser the stage's surface runs it on an animation frame, with the paint that shows the
// pictures; with no paint it runs to its end.
import type { Design, Rect } from '@dazbee/schema'

import type { DrawInfo } from '../core-interface.ts'
import { imageUses } from '../display-copies.ts'
import type { EditorPointer } from '../gestures/pointer.ts'
import { carried } from '../gestures/select/transform-drag.ts'
import { listenerSet } from '../listener-set.ts'
import type { EditorResources } from '../resources.ts'
import type { EditorSelection } from '../selection.ts'
import type { EditorTyping } from '../text/typing.ts'
import { type ConnectorCurve, connectorsShown } from './connectors.ts'
import type { FramePicture } from './frames.ts'
import type { FrameScenes } from './scenes.ts'
import type { ShownSections } from './sections.ts'
import type { EditorView } from './view.ts'

/** A section's outline as the stage draws it, in screen pixels: lit while the section is picked or a drop's target. */
export interface DrawnOutline {
  box: Rect
  lit: boolean
}
/** A connector's curve as the stage draws it, in screen pixels: blue while it is picked. */
export interface DrawnConnector {
  curve: ConnectorCurve
  picked: boolean
}
/**
 * Puts the sections' outlines on the screen, then the connectors' curves, then the pictures of the
 * frames in view over them, then `ghost`, what a drag carries, faintly where it is past its frame's
 * edge. False, having drawn nothing, when there is nothing to draw on.
 */
export type Paint = (
  pictures: readonly FramePicture[],
  ghost: FramePicture | null,
  outlines: readonly DrawnOutline[],
  connectors: readonly DrawnConnector[],
) => boolean

export interface RedrawDeps {
  view: Pick<
    EditorView,
    'update' | 'design' | 'previewed' | 'frames' | 'findInView' | 'inView' | 'camera' | 'dpr' | 'redraw'
  >
  resources: Pick<EditorResources, 'screen' | 'show'>
  scenes: Pick<FrameScenes, 'shownScene' | 'pictures' | 'ghost' | 'outlinePaths'>
  selection: Pick<EditorSelection, 'keep' | 'tellListeners' | 'pickedSection' | 'pickedConnector'>
  typing: Pick<EditorTyping, 'stopWhenGone'>
  pointer: Pick<EditorPointer, 'gesture' | 'rehover'>
  /** The sections as the stage shows them now. */
  sections: () => ShownSections
  /** Tells the page, once, how many layers the open design leaves out. */
  leftOut: { tell(): void }
  /** Tells the draw listeners of a redraw: the design it drew, when, and what it did. */
  report: (design: Design, at: number, info: DrawInfo) => void
}

export interface EditorRedraw {
  /**
   * Runs the redraw pass, handing the pictures to `paint` when there is one. Returns what it did,
   * which the draw listeners hear too; null, the pass stopped there, when `paint` answered false.
   */
  redraw(paint?: Paint): DrawInfo | null
  /**
   * Tells that what is shown changed: the `onShown` listeners first, which build what they show,
   * then the selection's listeners. A redraw calls it, and so does every module that changes what
   * is shown outside one; when the sections' outlines or the picked connector differ from those
   * last drawn, as after a section or a connector is picked or a frame's drop, it asks for a redraw,
   * since the surface draws them.
   */
  shownChanged(): void
  /** Calls back whenever what is shown changed, before the selection's listeners are told. */
  onShown(listener: () => void): () => boolean
}

export function editorRedraw({
  view,
  resources,
  scenes,
  selection,
  typing,
  pointer,
  sections,
  leftOut,
  report,
}: RedrawDeps): EditorRedraw {
  /** Told when what is shown changed. */
  const shown = listenerSet<[]>()
  /** The sections' outlines and the picked connector the last redraw drew, as `drawnKey` gives them. */
  let drawnOutlines = ''

  function redraw(paint?: Paint): DrawInfo | null {
    const started = performance.now()
    view.update()
    selection.keep()
    typing.stopWhenGone()
    const design = view.design()
    const inView = view.findInView()
    // The images of the page, hidden ones too while they show, and the size they are shown at, which their display copies follow.
    resources.show(imageUses(view.frames().map(scenes.shownScene)), view.camera().zoom * view.dpr())
    // The resources of what the pictures show: a layer another tab previews can bring an image or a font.
    const screen = resources.screen(
      view.previewed(),
      view.frames().map((frame) => frame.id),
    )
    // What a drag carries, drawn faintly past its frame's edge. It is recorded before the frames'
    // pictures: recording it checks its frame's scene, and a scene made again lets go of the
    // picture the frame had.
    const drag = carried(pointer.gesture())
    const ghost = drag && { frame: drag.frame, picture: scenes.ghost(drag.frame, drag.roots, screen) }
    const made = scenes.pictures(view.frames(), inView, screen)
    // The sections are measured once for the outlines and the connectors' ends.
    const shownSections = sections()
    const outlines = outlinesNow(shownSections)
    if (paint && !paint(made.pictures, ghost, outlines, connectorsNow(design, shownSections))) return null
    drawnOutlines = drawnKey(outlines)
    pointer.rehover()
    const outlinedBefore = scenes.outlinePaths()
    shownChanged()
    const info = {
      outlined: scenes.outlinePaths() - outlinedBefore,
      ms: performance.now() - started,
      drawn: view.inView().length,
      frames: view.frames().length,
      recorded: made.recorded,
    }
    report(design, performance.timeOrigin + performance.now(), info)
    leftOut.tell()
    return info
  }
  /** The sections' outlines as the stage draws them, lit where picked or a drop's target. */
  function outlinesNow({ outlines, lit }: ShownSections = sections()): DrawnOutline[] {
    const picked = selection.pickedSection()
    return outlines.map(({ id, box }) => ({ box, lit: id === picked || id === lit }))
  }
  /** The connectors' curves between where their ends are drawn now, blue where picked. */
  function connectorsNow(design: Design, { outlines }: ShownSections): DrawnConnector[] {
    const picked = selection.pickedConnector()
    return connectorsShown(design, view.frames(), outlines, view.camera()).map(({ id, curve }) => ({
      curve,
      picked: id === picked,
    }))
  }
  /** What the surface draws besides the frames that a pick changes, as one string: the outlines and the picked connector. */
  function drawnKey(outlines: readonly DrawnOutline[]) {
    const picked = selection.pickedConnector()
    return picked === null ? outlineKey(outlines) : `${outlineKey(outlines)}|${picked}`
  }
  function shownChanged() {
    if (drawnKey(outlinesNow()) !== drawnOutlines) view.redraw()
    shown.emit()
    selection.tellListeners()
  }

  return { redraw, shownChanged, onShown: shown.on }
}

/** The outlines as one string, where each box and whether it is lit. */
function outlineKey(outlines: readonly DrawnOutline[]) {
  return outlines.map(({ box, lit }) => `${box.x} ${box.y} ${box.width} ${box.height}${lit ? ' lit' : ''}`).join(',')
}
