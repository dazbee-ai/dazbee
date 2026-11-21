// Putting things on the canvas: copying, cutting and pasting layers (image files pasted are placed
// through place-images, an SVG file or its markup through place-svg, and other plain text pasted
// becomes a text layer), placing an image, and putting an image into a layer as its fill, with the
// layer a dragged image would go into.
import { ancestorsOf, childrenOf, frameIdOf, placedRoots, type Session } from '@dazbee/doc'
import { brandRef, canHold, type Layer, LayerClipboard, LOGO_ROLE, type Paint, type Point } from '@dazbee/schema'
import { SVG_TYPE, svgMarkup } from '@dazbee/svg'

import type { EditorActions } from './actions.ts'
import type { EditorView, Spot } from './canvas/view.ts'
import {
  type ClipboardFile,
  type ClipboardPayload,
  copyPayload,
  layersOnClipboard,
  type Remembered,
  rememberedLayers,
} from './clipboard.ts'
import type { NoticeDetail } from './core-interface.ts'
import { newImage, withImage } from './gestures/drawing/draw-tools.ts'
import type { EditorBoxes } from './layers/boxes.ts'
import { hug as hugIn } from './layers/hug.ts'
import { boundsOf, localTo, round } from './layers/transform.ts'
import { type PastedText, pastedText } from './pasted-text.ts'
import type { EditorPlaceImages } from './place-images.ts'
import type { EditorPlaceSvg } from './place-svg.ts'
import { runQuietly } from './run-quietly.ts'
import { type EditorSelection, firstFrameOf, frameToPlaceIn, idsOf, type Picked } from './selection.ts'
import { stepOf } from './shortcuts.ts'
import type { EditorTyping } from './text/typing.ts'
import type { EditorTools, PlacedAsset, PlaceImageOptions } from './tools.ts'

export interface PlaceDeps {
  session: Session
  /** The design the copied layers come from. */
  designId: string
  /** Where the last copy is kept on this device. */
  remembered: Remembered
  view: Pick<
    EditorView,
    'design' | 'frames' | 'frameOf' | 'inView' | 'middleFrame' | 'nearestFrame' | 'pointOn' | 'spotOn'
  >
  tools: Pick<EditorTools, 'setTool'>
  selection: Pick<EditorSelection, 'current' | 'pickedFrame' | 'entered' | 'select'>
  boxes: Pick<EditorBoxes, 'roots' | 'rootsByFrame' | 'boxIn' | 'containersOf' | 'pickable' | 'pickAt' | 'storedNewBox'>
  typing: Pick<EditorTyping, 'editing' | 'selectedText' | 'stop' | 'fitText' | 'copy' | 'cut' | 'paste'>
  actions: Pick<EditorActions, 'perform'>
  /** Reads and places an SVG file or its markup pasted. */
  svg: EditorPlaceSvg
  /** Reads, uploads and places image files pasted. */
  images: EditorPlaceImages
  /** Tells the app that a paste found no frame on the page to go in. */
  notify: (...told: NoticeDetail<'pasteNeedsFrame'>) => void
  /** Aborted when the editor is destroyed: a file read after that places nothing. */
  signal: AbortSignal
  /** Tells that what is shown changed. */
  shownChanged: () => void
}

export interface EditorPlace {
  /** The layer an image dragged over the stage would go into, outlined while it is over it. */
  dropTarget(): Picked | null
  /** A copy: the text selected in the text being edited, or else the selected layers, as a payload; null with nothing to copy. */
  copy(): ClipboardPayload | null
  /**
   * The selected layers of the first selected frame as Copy takes them, with everything inside them,
   * each box as drawn in its parent; null while a text is typed in or nothing is selected.
   */
  copied(): LayerClipboard | null
  /** Whether a copy has something to copy now, as `copy` finds it, writing nothing. */
  canCopy(): boolean
  /**
   * A cut: the selected layers as a payload, then deleted, or the text selected in the text being
   * edited, taken out of it; null with nothing to cut.
   */
  cut(): ClipboardPayload | null
  /**
   * A paste: copied layers, or image files, or an SVG file or its markup, or other plain text as a
   * text layer, or text into the text being edited.
   * `pointer` is where the pointer is over the stage, as a stage point, or null. Returns at
   * once whether it took the payload, from what the payload names: a file is read afterwards.
   */
  paste(payload: ClipboardPayload, pointer: () => Point | null): boolean
  /** Mod+V went down: the paste that follows goes where the pointer is when Shift is down too. */
  aimPaste(atPointer: boolean): void
  /**
   * The selected layers as a payload, kept on this device for Paste in a menu; null with nothing to
   * copy, or when the device keeps nothing.
   */
  copyLayers(): ClipboardPayload | null
  /** Whether Paste in a menu has layers to place: the ones last copied in Dazbee on this device. */
  canPasteLayers(): boolean
  /** Pastes the layers last copied in Dazbee on this device, with the pointer where it is; false with none kept or nothing pasted. */
  pasteLayers(pointer: () => Point | null): boolean
  /**
   * Places an image asset as a graphic filled with it, centred on a spot or a stage point, or in the
   * frame in view; as the brand's logo, with the role logo and its picture bound to `brand:logo`.
   */
  placeImage(asset: PlacedAsset, where?: Point | Spot, options?: PlaceImageOptions): string | null
  /** Outlines the layer an image dragged over the stage point `stage` would go into, or none with null; returns its id. */
  imageTarget(stage: Point | null): string | null
  /** Puts an image into a layer as its fill, as one undo step; selects the layer in its frame. */
  fillWithImage(id: string, asset: PlacedAsset): boolean
}

export function editorPlace({
  session,
  designId,
  remembered,
  view,
  tools,
  selection,
  boxes,
  typing,
  actions,
  svg,
  images,
  notify,
  signal,
  shownChanged,
}: PlaceDeps): EditorPlace {
  const { design: drawn, frames, frameOf, inView, pointOn, spotOn } = view
  /** Groups fit what they hold again after a change inside them, in the same undo step. */
  const hug = (ids: string[]) => hugIn(session, ids)
  /** The layer an image dragged over the stage would be put into, outlined while it is over it. */
  let dropTarget: Picked | null = null
  /** Whether the paste being made goes where the pointer is (Mod+Shift+V), not where the layers were. */
  let pasteAtPointer = false

  function currentDropTarget() {
    return dropTarget
  }
  /**
   * The layer under a stage point that an image dropped there goes into as its
   * fill: a shape, box or boolean (a shape inside a boolean gives the boolean, whose paint shows),
   * not a line, and not one whose style is locked. Null over text, a group's gaps or empty space.
   */
  function imageTargetAt(stage: Point): Picked | null {
    const design = drawn()
    const at = pointOn(stage)
    const hit = at && boxes.pickAt(at.frame, at.p, { pickable: boxes.pickable })
    if (!at || !hit) return null
    let id = hit.id
    for (const up of ancestorsOf(design, design.nodes[id]?.parentId ?? ''))
      if (design.nodes[up]?.type === 'boolean') id = up
    return takesImage(design.nodes[id]) ? { id, frameId: at.frame.id } : null
  }

  /**
   * The selected layers as a tree for the clipboard (#49), bottom to top with everything inside
   * them, each with its own props and its box as drawn, placed by auto layout, with the page and
   * frame they came from.
   */
  function copiedLayers(): LayerClipboard | null {
    // With layers selected in several frames, the first one's frame is copied: a paste goes into one frame.
    const frame = frameOf(firstFrameOf(selection.current()))
    if (!frame || typing.editing()) return null
    const now = session.design()
    const stacked: string[] = []
    const walk = (parentId: string) => {
      for (const [id] of childrenOf(now, parentId)) {
        stacked.push(id)
        walk(id)
      }
    }
    walk(frame.id)
    const inFrame = boxes.rootsByFrame(now).find((part) => part.frame.id === frame.id)?.ids ?? []
    const tops = inFrame.sort((a, b) => stacked.indexOf(a) - stacked.indexOf(b))
    if (tops.length === 0) return null
    const nodes: Record<string, Layer> = {}
    const add = (id: string) => {
      const node = now.nodes[id]
      const box = boxes.boxIn(id, now)
      if (!node || !box) return
      nodes[id] = { ...node, props: { ...node.props, ...box } } as Layer
      for (const [child] of childrenOf(now, id)) add(child)
    }
    for (const id of tops) add(id)
    return {
      kind: 'dazbee.layers',
      designId,
      pageId: frame.pageId,
      frameId: frame.id,
      tree: { nodes, roots: tops },
    }
  }
  /**
   * Pastes layers (#49) into the frame the selection is in, or else the one under the pointer: in
   * the group or box double-clicked into when it can hold them, otherwise at the frame's top level,
   * where they were or centred on the pointer. Where they were is kept in the frame they came from;
   * at the top level of another frame they are moved the least that puts them inside it, and centred
   * along a side they are longer than. Onto another frame of the page they were copied
   * from, each is a linked copy where that frame holds no layer with its link id; into their own
   * frame, onto another page or from another design, each is a new layer with a link id of its own.
   * One undo step; the pasted layers end up selected. On a page with no frame it says to add one;
   * returns whether it pasted.
   */
  function pasteTree(
    { tree, designId: from, pageId, frameId }: LayerClipboard,
    atPointer: boolean,
    pointer: Point | null,
  ) {
    const under = pointer ? pointOn(pointer) : null
    const frame = frameOf(firstFrameOf(selection.current())) ?? under?.frame ?? inView()[0] ?? frames()[0]
    if (!frame) {
      notify('pasteNeedsFrame')
      return false
    }
    const now = session.design()
    const entered = selection.entered()
    const inside = entered ? now.nodes[entered] : undefined
    const holds = inside && tree.roots.every((root) => canHold(inside.type, tree.nodes[root]?.type ?? ''))
    const parentId = entered && holds && firstFrameOf(selection.current()) === frame.id ? entered : frame.id
    // Drawn where they were, or centred on the pointer, and stored where that is drawn.
    const b = boundsOf(
      tree.roots.flatMap((root) => {
        const props = tree.nodes[root]?.props
        return props
          ? [{ x: props.x, y: props.y, width: props.width, height: props.height, rotation: props.rotation }]
          : []
      }),
    )
    let drawnAt = { x: b.x, y: b.y }
    if (atPointer && under?.frame.id === frame.id) {
      const p = localTo(under.p, boxes.containersOf(frame, parentId, now))
      drawnAt = { x: p.x - b.width / 2, y: p.y - b.height / 2 }
    } else if (parentId === frame.id && !(from === designId && frame.id === frameId)) {
      // Where they were in another frame can be off this one: they come in by the least they must.
      drawnAt = { x: within(b.x, b.width, frame.width), y: within(b.y, b.height, frame.height) }
    }
    const at = boxes.storedNewBox(drawnAt, parentId)
    const dx = round(at.x - b.x)
    const dy = round(at.y - b.y)
    let pasted: string[] = []
    if (
      !runQuietly(() =>
        session.gesture(stepOf('paste'), () => {
          const linked = from === designId && frame.id !== frameId
          pasted = placedRoots(
            session.run('design.place', { parentId, tree, dx, dy, ...(linked ? { keepLinksFrom: pageId } : {}) }),
          )
          if (now.nodes[parentId]) hug([parentId])
        }),
      )
    )
      return false
    selection.select(pasted, frame.id)
    return true
  }

  /**
   * Reads an SVG file or its markup pasted, at the stage point `stage` or else in the frame in view,
   * and places it once nothing is open on the stage.
   */
  async function pasteSvg(text: string, name: string, stage: Point | null) {
    const read = await svg.readSvg(text, name, stage ?? undefined)
    if (read) await svg.placeWhenSettled(read)
  }

  /**
   * Where something pasted from outside goes, centred: on the stage point `stage` when it is on a
   * frame, in the middle of the selection's frame for a point off every frame, as an SVG pasted
   * there goes, or else in the middle of the frame placing goes in. Null with no frame to go in.
   */
  function pasteSpot(stage: Point | null): Spot | null {
    const spot = stage ? spotOn(stage) : null
    if (spot) return spot
    const frame = (stage && frameOf(firstFrameOf(selection.current()))) ?? frameToPlaceIn(view, selection)
    return frame ? { frameId: frame.id, x: frame.width / 2, y: frame.height / 2 } : null
  }
  /**
   * Reads, uploads and places image files pasted (place-images) where `pasteSpot` says, read now:
   * into the one layer selected as its fill when it takes an image and the paste isn't aimed at the
   * pointer (Mod+Shift+V), else as new layers.
   */
  function pasteImages(files: readonly ClipboardFile[], atPointer: boolean, stage: Point | null) {
    const spot = pasteSpot(stage)
    if (!spot) return
    const [only, ...more] = idsOf(selection.current())
    const into = !atPointer && only && more.length === 0 && takesImage(session.design().nodes[only]) ? only : null
    void images.paste(files, { spot, into })
  }
  /**
   * Pastes a text layer made of plain text from outside (`pastedText`) where `pasteSpot` says,
   * measured in its font first. One undo step called paste, selected, with the select tool back.
   */
  function pasteText(made: PastedText, stage: Point | null) {
    const at = pasteSpot(stage)
    const frame = at && frameOf(at.frameId)
    if (!at || !frame) return
    const layer = { ...made, props: { ...made.props, x: Math.round(at.x), y: Math.round(at.y) } }
    let id = ''
    const ok = runQuietly(() =>
      session.gesture(stepOf('paste'), () => {
        id = session.run('node.create', { parentId: frame.id, layer })
        typing.fitText(id)
        // Centred on whole pixels on its size as fitted. Text in a font still coming is fitted
        // again once it arrives, from the same corner.
        const fitted = session.design().nodes[id]?.props
        if (fitted && (fitted.width > 0 || fitted.height > 0))
          session.run('node.update', {
            ids: [id],
            patch: { x: Math.round(at.x - fitted.width / 2), y: Math.round(at.y - fitted.height / 2) },
          })
      }),
    )
    if (!ok || !id) return
    tools.setTool('select')
    selection.select([id], frame.id)
  }

  // Copy, cut and paste plain text while typing (#47), and layers otherwise (#49). Pasted line
  // breaks become paragraphs.
  function copy(): ClipboardPayload | null {
    if (typing.editing()) return typing.copy()
    const copied = copiedLayers()
    return copied && copyPayload(remembered, copied).payload
  }
  function canCopy() {
    return typing.editing() ? typing.selectedText() !== null : copiedLayers() !== null
  }
  function cut(): ClipboardPayload | null {
    if (typing.editing()) return typing.cut()
    const copied = copiedLayers()
    if (!copied) return null
    const { payload } = copyPayload(remembered, copied)
    session.gesture(stepOf('cut'), () => actions.perform('delete'))
    return payload
  }
  function paste(payload: ClipboardPayload, pointer: () => Point | null) {
    if (typing.editing()) return typing.paste(payload)
    // Layers copied in this or another design, then image files, then an SVG file or its markup,
    // then any other plain text, which becomes a text layer; anything else isn't ours to paste.
    const copied = layersOnClipboard(remembered, payload)
    const atPointer = pasteAtPointer
    pasteAtPointer = false
    if (copied) {
      pasteTree(copied, atPointer, pointer())
      return true
    }
    if (payload.files && images.takes(payload.files)) {
      if (frames().length === 0) notify('pasteNeedsFrame')
      else pasteImages(payload.files, atPointer, atPointer ? pointer() : null)
      return true
    }
    const file = payload.files?.find((f) => f.type === SVG_TYPE)
    const markup = svgMarkup(payload.data?.[SVG_TYPE] || payload.text)
    // A file copied from the computer brings its name as plain text too, which is no text to paste.
    const text = payload.files?.length ? null : pastedText(payload.text ?? '')
    if (!file && !markup && !text) return false
    if (frames().length === 0) {
      notify('pasteNeedsFrame')
      return true
    }
    const stage = atPointer ? pointer() : null
    if (markup) void pasteSvg(markup, 'SVG', stage)
    else if (file) {
      void file.text().then((read) => {
        if (!signal.aborted) return pasteSvg(read, file.name.replace(/.svg$/i, '') || 'SVG', stage)
      })
    } else if (text) pasteText(text, stage)
    return true
  }
  function aimPaste(atPointer: boolean) {
    pasteAtPointer = atPointer
  }

  function copyLayers() {
    const copied = copiedLayers()
    if (!copied) return null
    const { payload, kept } = copyPayload(remembered, copied)
    return kept ? payload : null
  }
  function canPasteLayers() {
    return rememberedLayers(remembered) !== null
  }
  function pasteLayers(pointer: () => Point | null) {
    const copied = rememberedLayers(remembered)
    if (!copied) return false
    return pasteTree(copied, false, pointer())
  }
  function placeImage(asset: PlacedAsset, where?: Point | Spot, { logo }: PlaceImageOptions = {}): string | null {
    // A point off every frame places nothing; with no point, it goes where `frameToPlaceIn` says.
    const spot = where && ('frameId' in where ? where : spotOn(where))
    if (where && !spot) return null
    const frame = spot ? frameOf(spot.frameId) : frameToPlaceIn(view, selection)
    if (!frame) return null
    const at = spot ? { x: spot.x, y: spot.y } : { x: frame.width / 2, y: frame.height / 2 }
    typing.stop()
    let id = ''
    const layer = { ...newImage(asset, at, frame), ...(logo ? { name: logo.name, role: 'logo' } : {}) }
    if (
      !runQuietly(() =>
        session.gesture(() => {
          id = session.run('node.create', { parentId: frame.id, layer })
          if (logo)
            session.run('node.bind', { ids: [id], property: 'image', ref: brandRef(LOGO_ROLE), value: asset.id })
        }),
      )
    )
      return null
    tools.setTool('select')
    selection.select([id], frame.id)
    return id
  }
  function imageTarget(stage: Point | null): string | null {
    const next = stage ? imageTargetAt(stage) : null
    if (next?.id !== dropTarget?.id || next?.frameId !== dropTarget?.frameId) {
      dropTarget = next
      shownChanged()
    }
    return next?.id ?? null
  }
  function fillWithImage(id: string, asset: PlacedAsset): boolean {
    const now = session.design()
    const node = now.nodes[id]
    if (!node || !('fills' in node.props) || node.lock?.style) return false
    const fills = node.props.fills as Paint[]
    const frameId = frameIdOf(now, id)
    dropTarget = null
    typing.stop()
    const ok = runQuietly(() => session.run('node.update', { ids: [id], patch: { fills: withImage(fills, asset.id) } }))
    if (ok && frameId !== undefined) selection.select([id], frameId)
    shownChanged()
    return ok
  }

  return {
    dropTarget: currentDropTarget,
    copy,
    copied: copiedLayers,
    canCopy,
    cut,
    paste,
    aimPaste,
    copyLayers,
    canPasteLayers,
    pasteLayers,
    placeImage,
    imageTarget,
    fillWithImage,
  }
}

/** Whether a layer takes an image as its fill: a shape, box or boolean, not a line, and not one whose style is locked. */
function takesImage(node: Layer | undefined) {
  const takes =
    node?.type === 'box' || node?.type === 'boolean' || (node?.type === 'graphic' && node.props.shape.kind !== 'line')
  return takes && !node.lock?.style
}

/**
 * Where a span that starts at `start` and is `length` long goes to lie inside a side `side` long:
 * moved the least that does that, or centred on the side when it is longer than it.
 */
function within(start: number, length: number, side: number) {
  if (length >= side) return (side - length) / 2
  return Math.min(Math.max(start, 0), side - length)
}
