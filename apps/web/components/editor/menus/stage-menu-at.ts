// What a right-click on the stage opens the stage menu for, and what it picks: a section, a layer or a frame.
import type { Editor, LayerAt, Point } from '@dazbee/editor'

/**
 * The menu open at a right-click: where it went down, what it was on, the frame whose actions it
 * shows, the layers under it, front-most first, and whether it offers Show hidden layers.
 */
export interface StageMenuOpen {
  at: Point
  /** A layer, whose actions it shows; a frame, by its empty area or its label; a section, by its title or outline line; or the canvas outside every frame. */
  on: 'layer' | 'frame' | 'section' | 'canvas'
  frameId: string | null
  /** The section whose actions it shows, on a section. */
  sectionId?: string
  layers: LayerAt[]
  /** Whether it offers Show hidden layers, ticked while they show: the design has some hidden, or they show. */
  hidden: boolean
}

/**
 * Picks what a right-click at a client point acts on, and gives the stage menu it opens: on a
 * section's title (`titled`, the section whose title is there) or outline line, the section's
 * actions, the section picked, but to a tab that may only view Show hidden layers alone; on a layer,
 * the layer's actions, the layer selected; on a frame's empty area or on the name or size of its
 * label (`labelFrameId`, the frame whose label is there), the frame's actions, the frame picked;
 * outside every frame, Show hidden layers alone. Each offers Show hidden layers while the design has
 * hidden layers or they show (`toggleHiddenShown` ready), a view only this tab has, so a tab that
 * may only view is offered it too. Null where it opens nothing.
 */
export function rightClickAt(
  editor: Editor,
  client: Point,
  { labelFrameId, titled }: { labelFrameId: string | undefined; titled?: string | undefined },
): StageMenuOpen | null {
  const hidden = editor.actionReady('toggleHiddenShown')
  const sectionId = labelFrameId === undefined ? (titled ?? editor.sectionAt(client)) : null
  if (sectionId) {
    editor.pickSection(sectionId)
    // A tab that may only view has no section actions: Show hidden layers alone, while offered.
    if (editor.readOnly()) return hidden ? { at: client, on: 'canvas', frameId: null, layers: [], hidden } : null
    return { at: client, on: 'section', frameId: null, sectionId, layers: [], hidden }
  }
  const ids = labelFrameId === undefined ? editor.selectAt(client) : []
  if (ids.length > 0) return { at: client, on: 'layer', frameId: null, layers: editor.layersAt(client), hidden }
  const frameId = labelFrameId ?? editor.spotAt(client)?.frameId ?? null
  if (frameId === null) return hidden ? { at: client, on: 'canvas', frameId: null, layers: [], hidden } : null
  editor.pickFrame(frameId)
  return { at: client, on: 'frame', frameId, layers: [], hidden }
}
