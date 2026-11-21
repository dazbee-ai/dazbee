// Placing an import from Figma: once nothing is open on the stage, its pages and frames are added
// and each frame's layers placed, with their texts fitted, as one undo step, checked first and last
// against the design's limits, so past one nothing is written; then what the sync server does with
// the step is told through `confirmed`.
import { CommandError, designSizeOf, type DesignStore, type Session } from '@dazbee/doc'
import { type DesignSize, type FigmaFrame, type FigmaImport, SYNC_LIMITS } from '@dazbee/schema'

import type { EditorView } from './canvas/view.ts'
import type { EditorTyping } from './text/typing.ts'

/** A limit of a design's size that an import may pass. */
export type DesignLimit = 'designLayers' | 'designFrames' | 'designPages' | 'designBytes'

/** What placing an import did. */
export type PlacedFigma =
  /**
   * Placed as one undo step: each Figma node id of the import by the Dazbee page, frame or layer it
   * became, and `whenConfirmed` on the step, which settles once the sync server answers it.
   */
  | { placed: true; ids: ReadonlyMap<string, string>; confirmed: Promise<'saved'> }
  /** Nothing placed: the editor has ended, or the tab may only view the design. */
  | { placed: false; why: 'ended' | 'viewOnly' }
  /** Nothing placed: the design holding the import would pass `limit`. */
  | { placed: false; why: 'limit'; limit: DesignLimit }
  /** Nothing placed: a command refused it, for `reason`. */
  | { placed: false; why: 'refused'; reason: string }

export interface PlaceFigmaDeps {
  session: Session
  store: Pick<DesignStore, 'snapshot'>
  view: Pick<EditorView, 'page'>
  typing: Pick<EditorTyping, 'stop' | 'fitText'>
  /** Resolves once no gesture is open on the stage; false once the editor has ended. */
  whenSettled: () => Promise<boolean>
  /** Whether a gesture or a drag is open on the stage now. */
  gesturing: () => boolean
  /** Aborted when the editor is destroyed: nothing is placed after that. */
  signal: AbortSignal
}

export interface EditorPlaceFigma {
  /**
   * Places `figma` once no gesture is open on the stage, as one undo step named `importFigma`: a
   * file's or a page's pages each a new page at the end, named as in Figma, with its frames where
   * Figma has them; a frame link's frame onto the shown page by the frame rule. Each frame's layers
   * are placed in it and its texts that grow with their words fitted, in the same step. Past a
   * design limit (`SYNC_LIMITS`), counted on the design as it is then, nothing is written.
   */
  placeFigma(figma: FigmaImport): Promise<PlacedFigma>
}

/** The limits an import is checked against, by the part of a design's size each caps. */
const LIMITS: readonly [keyof DesignSize, DesignLimit][] = [
  ['layers', 'designLayers'],
  ['frames', 'designFrames'],
  ['pages', 'designPages'],
  ['bytes', 'designBytes'],
]

export function editorPlaceFigma({
  session,
  store,
  view,
  typing,
  whenSettled,
  gesturing,
  signal,
}: PlaceFigmaDeps): EditorPlaceFigma {
  async function placeFigma(figma: FigmaImport): Promise<PlacedFigma> {
    // A gesture begun as the wait ends is waited for too, so the import is a step of its own.
    do {
      if (!(await whenSettled())) return { placed: false, why: 'ended' }
    } while (gesturing())
    if (signal.aborted) return { placed: false, why: 'ended' }
    if (session.readOnly()) return { placed: false, why: 'viewOnly' }
    return place(figma)
  }

  /** Places `figma` now, with nothing open on the stage. */
  function place(figma: FigmaImport): PlacedFigma {
    const before = designSizeOf(store.snapshot())
    const counted = passed(before, added(figma, before))
    if (counted) return { placed: false, why: 'limit', limit: counted }
    typing.stop()
    const step = session.beginGesture('importFigma')
    let ids: Map<string, string>
    try {
      ids = write(figma)
      const past = passed(before, designSizeOf(store.snapshot()))
      if (past) {
        step.cancel()
        return { placed: false, why: 'limit', limit: past }
      }
    } catch (error) {
      step.cancel()
      if (error instanceof CommandError) return { placed: false, why: 'refused', reason: error.message }
      throw error
    }
    step.end()
    const confirmed = session.whenConfirmed(step)
    // An import nobody waits for any more, such as one whose card closed, fails quietly.
    confirmed.catch(() => {})
    return { placed: true, ids, confirmed }
  }

  /**
   * Writes the import's pages, frames and layers, fitting its texts; gives each Figma node id's new
   * page, frame or layer. A Figma id named twice, as a page's by the frame of its loose layers or a
   * layer's by the frame it was linked alone in, takes the layer over the page over the frame.
   */
  function write(figma: FigmaImport): Map<string, string> {
    const pages = new Map<string, string>()
    const layers = new Map<string, string>()
    /** Each frame of the import with the frame it became. */
    const made: [FigmaFrame, string][] = []
    if (figma.target === 'pages') {
      const added = session.run('page.addMany', {
        pages: figma.pages.map((page) => ({
          name: page.name,
          frames: page.frames.map(({ name, width, height, x, y, fills }) => ({ name, width, height, x, y, fills })),
        })),
      })
      for (const [p, page] of figma.pages.entries()) {
        const { id, frames } = added[p] as (typeof added)[number]
        if (page.figmaId !== '') pages.set(page.figmaId, id)
        for (const [f, frame] of page.frames.entries()) made.push([frame, frames[f] as string])
      }
    } else {
      const shown = view.page()
      for (const page of figma.pages) {
        if (page.figmaId !== '') pages.set(page.figmaId, shown)
        for (const frame of page.frames) made.push([frame, addFrame(shown, frame)])
      }
    }
    for (const [frame, frameId] of made) if (frame.layers) placeLayers(frameId, frame, layers)
    const frames = made.map(([frame, frameId]): [string, string] => [frame.figmaId, frameId])
    return new Map([...frames, ...pages, ...layers])
  }

  /** Adds frame `f` to page `pageId` by the frame rule; gives its id. */
  function addFrame(pageId: string, f: FigmaFrame): string {
    const frameId = session.run('frame.add', { pageId, name: f.name, width: f.width, height: f.height })
    session.run('frame.update', { frameId, fills: f.fills })
    return frameId
  }

  /** Places frame `f`'s layers in frame `frameId`, telling `layers` each one's new id by its Figma id, and fits its texts. */
  function placeLayers(frameId: string, f: FigmaFrame, layers: Map<string, string>) {
    const tree = f.layers as NonNullable<FigmaFrame['layers']>
    const placed = session.run('design.place', { parentId: frameId, tree, withIds: true })
    const ids = new Map(Array.isArray(placed) ? [] : Object.entries(placed.ids))
    for (const [key, figmaId] of Object.entries(f.figmaIds)) {
      const id = ids.get(key)
      if (id) layers.set(figmaId, id)
    }
    // A text is measured in its font, as the editor lays it out; a fixed one keeps its size.
    for (const [key, id] of ids) if (tree.nodes[key]?.type === 'text') typing.fitText(id)
  }

  return { placeFigma }
}

/** What `figma` adds to a design's layers, frames and pages; its bytes are counted once it is written. */
function added(figma: FigmaImport, before: DesignSize): DesignSize {
  const frames = figma.pages.flatMap((page) => page.frames)
  return {
    layers: before.layers + frames.reduce((sum, f) => sum + Object.keys(f.layers?.nodes ?? {}).length, 0),
    frames: before.frames + frames.length,
    pages: before.pages + (figma.target === 'pages' ? figma.pages.length : 0),
    bytes: before.bytes,
  }
}

/** The limit `after` passes, as the sync server counts it: only a part that grew past its cap. */
function passed(before: DesignSize, after: DesignSize): DesignLimit | undefined {
  return LIMITS.find(([part, limit]) => after[part] > SYNC_LIMITS[limit] && after[part] > before[part])?.[1]
}
