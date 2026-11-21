// Placing an SVG file as layers: reading it where it was asked for, uploading the pictures it
// shows into the brand's library, then putting it down as one undo step once nothing is open on
// the stage.
import type { CanvasKit } from '@dazbee/canvaskit'
import { childrenOf, placedRoots, type Session } from '@dazbee/doc'
import type { Point } from '@dazbee/schema'
import { SvgError } from '@dazbee/svg'

import type { EditorView, Spot } from './canvas/view.ts'
import type { CoreStart, NoticeDetail } from './core-interface.ts'
import { type SvgLayers, svgLayers, svgPlaceInput } from './placed-asset.ts'
import { runQuietly } from './run-quietly.ts'
import { type EditorSelection, firstFrameOf, frameToPlaceIn } from './selection.ts'
import type { EditorTyping } from './text/typing.ts'
import type { EditorTools } from './tools.ts'
import type { EditorUploads } from './uploads.ts'

/** An SVG file read for placing: where it goes, and its layers with the uploaded pictures' assets. */
export interface SvgRead extends SvgLayers {
  /** The spot it goes on, centred, read when it was asked for: a pan or a zoom since doesn't move it. */
  spot: Spot
}

export interface PlaceSvgDeps {
  ck: CanvasKit
  session: Session
  view: Pick<EditorView, 'frames' | 'frameOf' | 'middleFrame' | 'nearestFrame' | 'spotOn'>
  tools: Pick<EditorTools, 'setTool'>
  selection: Pick<EditorSelection, 'current' | 'pickedFrame' | 'select'>
  typing: Pick<EditorTyping, 'stop' | 'fitText'>
  /** Tells that a file can't be read, or what of it no layer shows. */
  notify: (...told: NoticeDetail<'svgUnreadable' | 'svgLeftOut'>) => void
  /** Uploads the pictures a file shows; when it can't, they are left out. */
  uploads: EditorUploads
  /**
   * What is open on the stage, and what ends it: any gesture, a drag held on the stage, typing,
   * and a pen path as Enter ends it.
   */
  open: { gesturing: () => boolean; dragging: () => boolean; stopEditing: () => void; settle: () => void }
  /** The clock placing checks again by; without it, placing doesn't wait for a gesture. */
  after?: CoreStart['after']
  /** Aborted when the editor is destroyed: nothing is read or placed after that. */
  signal: AbortSignal
}

export interface EditorPlaceSvg {
  /**
   * Reads an SVG file to place, centred on `where`, a spot or a stage point, or else in the middle
   * of the frame in view; a stage point off every frame goes in the middle of the selection's frame.
   * The spot is read first, then the file is converted, scaled down to SVG_ROOM of the frame's
   * shorter side when larger, and the pictures it shows are uploaded, each distinct one once. Null when there is no frame, the editor has ended, or the file can't be
   * read, which is told.
   */
  readSvg(text: string, name: string, where?: Point | Spot): Promise<SvgRead | null>
  /**
   * Places a file read as a group of its layers, in one undo step, selected, with the select tool
   * back, and tells what no layer shows. Null when it placed nothing: a drag is held on the stage,
   * whose undo step it would join, the spot's frame is gone or not on the shown page, or the editor
   * has ended.
   */
  placeSvg(read: SvgRead): string | null
  /**
   * Resolves once no gesture is open on the stage, ending typing at once and a pen path
   * PEN_LIMIT_MS after it was asked, as Enter ends it; a drag or a panel's scrub is waited for.
   * False once the editor has ended, or while a gesture runs when there is no clock to wait by.
   */
  whenSettled(): Promise<boolean>
  /** Places a file read once no gesture is open on the stage, as its own undo step; null when it placed nothing. */
  placeWhenSettled(read: SvgRead): Promise<string | null>
}

/** How often placing checks again whether a drag, scrub, pen path or typing has ended. */
const IDLE_CHECK_MS = 50
/** How long placing waits for a pen path, which only a key or a click ends, before it ends it. */
const PEN_LIMIT_MS = 3000

export function editorPlaceSvg({
  ck,
  session,
  view,
  tools,
  selection,
  typing,
  notify,
  uploads,
  open,
  after,
  signal,
}: PlaceSvgDeps): EditorPlaceSvg {
  async function readSvg(text: string, name: string, where?: Point | Spot): Promise<SvgRead | null> {
    const stage = where && !('frameId' in where) ? where : undefined
    const given = where && 'frameId' in where ? where : stage && view.spotOn(stage)
    // A point off every frame puts the file in the middle of the selection's frame; with no point,
    // it goes where `frameToPlaceIn` says.
    const frame = given
      ? view.frameOf(given.frameId)
      : stage
        ? view.frameOf(firstFrameOf(selection.current()))
        : frameToPlaceIn(view, selection)
    if (!frame || signal.aborted) return null
    const spot = given ?? { frameId: frame.id, x: frame.width / 2, y: frame.height / 2 }
    let read: SvgLayers
    try {
      read = await svgLayers(ck, text, { name, frame, ...(uploads.can() ? { upload: uploads.upload } : {}) })
    } catch (error) {
      if (!(error instanceof SvgError)) throw error
      notify('svgUnreadable')
      return null
    }
    return signal.aborted ? null : { spot, ...read }
  }

  function placeSvg(read: SvgRead): string | null {
    const { spot, leftOut, notUploaded } = read
    // The frame may have gone, or its page be no longer shown, while the pictures uploaded.
    const frame = view.frameOf(spot.frameId)
    const input = frame && svgPlaceInput(read, frame.id, spot)
    if (signal.aborted || open.dragging() || !frame || !session.design().frames[frame.id] || !input) return null
    typing.stop()
    let ids: string[] = []
    const ok = runQuietly(() =>
      session.gesture(() => {
        ids = placedRoots(session.run('design.place', input))
        // Text is measured in its font, as the editor lays it out.
        const placed = session.design()
        const fitTexts = (id: string) => {
          if (placed.nodes[id]?.type === 'text') typing.fitText(id)
          for (const [child] of childrenOf(placed, id)) fitTexts(child)
        }
        for (const id of ids) fitTexts(id)
      }),
    )
    const id = ids[0]
    if (!ok || !id) return null
    tools.setTool('select')
    selection.select([id], frame.id)
    if (leftOut.length > 0 || notUploaded > 0)
      notify('svgLeftOut', { parts: leftOut, ...(notUploaded > 0 ? { notUploaded } : {}) })
    return id
  }

  async function whenSettled(): Promise<boolean> {
    // Timed by the clock, not by the checks: a hidden tab runs them a second apart or more.
    const penUntil = Date.now() + PEN_LIMIT_MS
    for (;;) {
      if (signal.aborted) return false
      open.stopEditing()
      if (Date.now() >= penUntil) open.settle()
      if (!open.gesturing()) return true
      if (!after) return false
      await new Promise<void>((resolve) => after(IDLE_CHECK_MS, resolve))
    }
  }

  async function placeWhenSettled(read: SvgRead) {
    return (await whenSettled()) ? placeSvg(read) : null
  }

  return { readSvg, placeSvg, whenSettled, placeWhenSettled }
}
