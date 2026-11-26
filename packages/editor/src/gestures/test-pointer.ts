// The pointer's test fixtures: a stage over one square frame, its label, inputs, and the pointer
// over a real selection with every behaviour logging what it is asked.
import type { SceneLayer } from '@dazbee/renderer'
import type { Design } from '@dazbee/schema'

import type { Camera } from '../canvas/camera.ts'
import type { Frame } from '../canvas/frames.ts'
import { design as testDesign } from '../canvas/test-design.ts'
import type { Box } from '../layers/transform.ts'
import { editorSelection, type HeldSelection } from '../selection.ts'
import { onMac } from '../test-platform.ts'
import type { Tool } from '../tools.ts'
import { editorDragStart } from './drag-start.ts'
import { editorHold } from './hold.ts'
import type { PointerInput } from './inputs.ts'
import { editorPointer, type Gesture, type PointerDeps } from './pointer.ts'
import type { MoveDrag } from './select/move-drag.ts'
import { pointerInput } from './test-inputs.ts'

export const SQUARE: Frame = { id: 'one-sq', pageId: 'one', name: 'Square', x: 0, y: 0, width: 1080, height: 1080 }
/** A scene layer of a type over the first 100 pixels of the frame each way. */
export const sceneLayer = (id: string, type: string) =>
  ({
    id,
    type,
    props: { x: 0, y: 0, width: 100, height: 100, rotation: 0, shape: { kind: 'rect' } },
  }) as unknown as SceneLayer
export const UNDER = sceneLayer('under', 'graphic')
/** Where layers are drawn in the square, by id: the layer a hover over its first 100 pixels picks, and others to select. */
export const DRAWN: Record<string, Box> = {
  'under picked': { x: 0, y: 0, width: 100, height: 100, rotation: 0 },
  deep: { x: 10, y: 10, width: 20, height: 20, rotation: 0 },
  sel: { x: 200, y: 300, width: 40, height: 20, rotation: 0 },
  other: { x: 400, y: 300, width: 40, height: 20, rotation: 0 },
  turned: { x: 200, y: 300, width: 40, height: 40, rotation: 45 },
  group: { x: 150, y: 250, width: 400, height: 200, rotation: 0 },
}

/** A pointer input at a stage point, a mouse's left button with nothing held: a move until it is sent as another type. */
export const event = (x: number, y: number, extra: Partial<PointerInput> = {}): PointerInput =>
  pointerInput({ at: { x, y }, ...extra })
/** The square's label as the overlay draws it, 24 to 4 pixels over the frame's top: its name at 0–40 and its size at 1000–1080. */
const labelAt = (at: { x: number; y: number }) =>
  at.y >= -24 && at.y <= -4 && ((at.x >= 0 && at.x <= 40) || (at.x >= 1000 && at.x <= 1080)) ? SQUARE.id : undefined

/**
 * The pointer over a stage where stage points are design pixels of the square frame at zoom 1, its
 * label's name and size 24 to 4 pixels over its top, off every frame past 1100 across or above it,
 * with a real selection; every behaviour logs what it is asked. With the image tool to start with (`startTool`), a
 * photo is armed to place. With `handle`, a press anywhere is
 * on a handle of the selection; with `editing`, that text is being typed in, and a test that gives
 * it its whole box picks it there. `nodes` are the design's layers, where a layer's parent is read.
 * A mouse has been over the stage and left it.
 */
export function harness(
  startTool: Tool = 'select',
  under: SceneLayer = UNDER,
  handle = false,
  editing: string | null = null,
  nodes: Record<string, { type: string; parentId: string }> = {},
) {
  const design = { ...testDesign, nodes } as unknown as Design
  const log: string[] = []
  /** The tool in use; with the image tool, a photo is armed to place. */
  let tool = startTool
  /** How many times the pointer was held. */
  let holds = 0
  const held = editorHold()
  let camera: Camera = { x: 0, y: 0, zoom: 1 }
  let pressed: MoveDrag | null = null
  /** The drag the select tool's next press starts in place of a move, as `pressAs` sets it. */
  let next: Gesture | null = null
  /** What a move answers when asked whether its copies are where their originals are, as `copiesUnmovedFor` sets it. */
  let unmoved: HeldSelection | null = null
  /** The type of each pointer the transform drag was told it saw, in order. */
  const seen: string[] = []
  const selection = editorSelection({ drawn: () => design, frames: () => [SQUARE], changed: () => {} })
  const deps: PointerDeps = {
    dragStart: editorDragStart(),
    hold: {
      hold: () => {
        holds += 1
        held.hold()
      },
      taken: held.taken,
    },
    session: { design: () => design, readOnly: () => false },
    view: {
      camera: () => camera,
      design: () => design,
      setCamera: (next) => {
        camera = next
        log.push(`camera ${next.x} ${next.y}`)
      },
      stopGlide: () => {},
      viewport: () => ({ width: 1000, height: 800 }),
      zoomTo: (zoom, at) => log.push(`zoom ${zoom.toFixed(3)} at ${at?.x} ${at?.y}`),
      redraw: () => log.push('redraw'),
      pointOn: (stage) => (stage.x > 1100 || stage.y < 0 ? null : { frame: SQUARE, p: stage }),
    },
    tools: {
      tool: () => tool,
      setTool: (next) => {
        tool = next
        log.push(`tool ${next}`)
      },
      imageToPlace: () => (tool === 'image' ? { id: 'a1', name: 'Photo', width: 400, height: 200 } : null),
      snapping: () => true,
    },
    selection,
    boxes: {
      pickAt: (_frame, p, options) => {
        if (p.x < 0 || p.y < 0 || p.x > 100 || p.y > 100) return null
        return options?.wholeBox ? sceneLayer(options.wholeBox, 'text') : under
      },
      layersAt: (_frame, p) =>
        p.x > 100 || p.y > 100
          ? []
          : [
              { id: 'group', depth: 0 },
              { id: 'under', depth: 1 },
            ],
      pickable: () => true,
      selectionBox: () => null,
      target: (id) => `${id} picked`,
      drawnBoxOf: (_frame, id) => DRAWN[id] ?? null,
      deepAt: (_frame, p) => (p.x < 0 || p.y < 0 || p.x > 100 || p.y > 100 ? null : 'deep'),
      lockedAt: () => null,
    },
    typing: {
      editing: () => (editing ? { id: editing, frameId: SQUARE.id } : null),
      caretFromPoint: () => 0,
      caretTo: (_offset, extend) => {
        if (extend) log.push('select text to the pointer')
      },
      selectText: () => {},
      start: (id, frame) => log.push(`type into ${id} in ${frame}`),
      stop: () => {},
    },
    pen: {
      drawing: () => false,
      down: (_e, at) => log.push(`pen down ${at.p.x} ${at.p.y}`),
      move: () => {},
      up: () => {},
      pressPoints: () => null,
      pointsAt: () => false,
      dragPoints: (_g, p) => log.push(`points to ${p.x} ${p.y}`),
      releasePoints: () => {},
    },
    cropping: {
      start: () => false,
      cursorAt: () => '',
      press: () => null,
      drag: (_g, p) => log.push(`crop to ${p.x} ${p.y}`),
      release: () => {},
    },
    drawing: {
      pressShape: () => null,
      pressImage: () => ({ kind: 'imageBox' }) as ReturnType<PointerDeps['drawing']['pressImage']>,
      pressText: () => ({ kind: 'textBox' }) as ReturnType<PointerDeps['drawing']['pressText']>,
      pressFrame: (_e, world) => {
        log.push(`frame from ${world.x} ${world.y}`)
        return { kind: 'frameDraw', from: world, to: world }
      },
      pressSection: (_e, world) => {
        log.push(`section from ${world.x} ${world.y}`)
        return { kind: 'sectionDraw', from: world, to: world }
      },
      drag: (g, p) => log.push(`${g.kind === 'frameDraw' ? 'frame' : g.kind} to ${p.x} ${p.y}`),
      release: (g) => log.push(g.kind === 'frameDraw' ? 'frame drawn' : `release ${g.kind}`),
    },
    transformDrag: {
      handleUnder: () => (handle ? { kind: 'resize', handle: 'n', drawn: false } : null),
      hoverDot: () => false,
      // The dots change here whenever the type of the pointer seen does.
      sawPointer: (type) => {
        const changed = type !== seen.at(-1)
        seen.push(type)
        return changed
      },
      marquee: (g) => log.push(`marquee to ${g.to.x} ${g.to.y}`),
      drag: (_g, p, _shift, _alt, snap) => log.push(`drag ${p.x} ${p.y}${snap ? ' snapped' : ''}`),
      release: (g) =>
        log.push(
          g.kind === 'move' && g.drop
            ? 'release move into a flow'
            : g.kind === 'move' && g.target
              ? 'release move onto a frame'
              : 'release move',
        ),
      clearSnapLines: () => {},
      setAlt: (_g, alt) => log.push(`alt ${alt ? 'down' : 'up'}`),
      // Every move the select tool's press starts here carries layers.
      carries: () => true,
      copiesUnmoved: () => unmoved,
    },
    autoLayoutDrag: {
      drag: (_g, p) => log.push(`reorder to ${p.x} ${p.y}`),
      setAlt: (_g, alt) => log.push(`reorder alt ${alt}`),
      cancel: () => log.push('cancel reorder'),
      release: () => log.push('release reorder'),
    },
    frameResize: {
      drag: (_g, world, e) => log.push(`move frame to ${world.x} ${world.y}${e.shiftKey ? ' along one axis' : ''}`),
      release: () => log.push('release frame move'),
      handleUnder: () => null,
    },
    sectionMove: {
      drag: (_g, world) => log.push(`move section to ${world.x} ${world.y}`),
      release: () => log.push('release section move'),
    },
    // No rulers: no press is a guide's.
    guideDrag: { press: () => null, drag: () => {}, release: () => {}, hover: () => false, cursorAt: () => '' },
    selectPress: {
      press: (_e, screen, _at, _deepest, label) => {
        log.push(`press ${screen.x} ${screen.y}${label ? ` over the label of ${label}` : ''}`)
        // Far along, a press starts no drag, as a Shift click that takes a layer out does.
        if (screen.x > 500) return null
        if (next) return next as MoveDrag
        const step = { end: () => log.push('end step'), cancel: () => log.push('cancel step') }
        pressed = { kind: 'move', frame: SQUARE, around: [], drop: null, step } as unknown as MoveDrag
        return pressed
      },
      pressLabel: (_e, screen, frameId) => {
        log.push(`press label of ${frameId} at ${screen.x} ${screen.y}`)
        return { kind: 'frameMove', frame: SQUARE, from: screen, step: null, own: null, stays: false, target: null }
      },
      // No section is drawn: a press on its title is the only one that grabs it.
      pressSection: (_e, screen, _at, title) => {
        if (title === undefined) return null
        log.push(`press title of ${title} at ${screen.x} ${screen.y}`)
        return { kind: 'sectionMove', sectionId: title, from: screen, moved: { x: 0, y: 0 }, step: null }
      },
      clicked: () => {},
      textBeforeClicks: () => undefined,
      release: (marquee, clicked) =>
        log.push(`release press${marquee ? ' marquee' : ''}${clicked ? '' : ' after a drag'}`),
      cancel: () => log.push('cancel press'),
      // As the press: off a handle and within the first 500 pixels across, a press moves the selection.
      dragAt: (screen, grabbed) => (selection.current() && !grabbed && screen.x <= 500 ? 'move' : null),
    },
    // Never picking a colour: every input is the pointer's.
    colourPick: { route: () => false, stop: () => false, picking: () => false },
    renameFrame: (frameId) => log.push(`rename ${frameId}`),
    renameSection: (sectionId) => log.push(`rename section ${sectionId}`),
    onMac,
    shownChanged: () => log.push('shown changed'),
  }
  const pointer = editorPointer(deps)
  /** Each cursor the pointer told its listeners, from its first. */
  const told: string[] = []
  pointer.onCursor((cursor) => told.push(cursor))
  /** Sends the pointer an input as a type, a press and a double click with the label under them, and gives its answer. */
  const send = (type: PointerInput['type'], e = event(0, 0)) => {
    const label = type === 'pointerdown' || type === 'dblclick' ? labelAt(e.at) : undefined
    return pointer.route({ ...e, type, ...(label ? { label } : {}) })
  }
  // A mouse has crossed the stage and left it, so a test starts from the pointer type seen.
  send('pointermove', event(2000, 2000))
  send('pointerleave', event(2000, 2000))
  log.length = 0
  return {
    pointer,
    selection,
    log,
    send,
    cursor: pointer.cursor,
    /** Each cursor the pointer told its listeners, from its first, the mouse crossing the stage's included. */
    told: () => [...told],
    pressed: () => pressed,
    /** Has the select tool's next press start a drag of this kind, over the square, in place of a move. */
    pressAs: (kind: Gesture['kind']) => {
      const step = { end: () => log.push('end step'), cancel: () => log.push('cancel step') }
      next = { kind, frame: SQUARE, around: [], from: { x: 0, y: 0 }, to: { x: 0, y: 0 }, step } as unknown as Gesture
    },
    /** Has every move answer that its copies are each where its original is, with the selection to put back. */
    copiesUnmovedFor: (picked: HeldSelection) => {
      unmoved = picked
    },
    holds: () => holds,
    /** The type of each pointer the transform drag was told it saw, in order. */
    seen: () => [...seen],
  }
}
