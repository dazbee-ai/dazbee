// The overlay's tests' fakes and fixtures, and the overlay over modules that each show one part.
import type { SceneLayer } from '@dazbee/renderer'
import { Design, GraphicProps, GroupProps } from '@dazbee/schema'

import type { PickShown } from '../gestures/colour-pick.ts'
import type { Gesture } from '../gestures/pointer.ts'
import type { Measured } from '../layers/measure.ts'
import type { Box, Handle } from '../layers/transform.ts'
import type { ShownPerson } from '../presence.ts'
import type { Picked } from '../selection.ts'
import { pairsIn } from '../selection.ts'
import type { Frame } from './frames.ts'
import { editorOverlay, type OverlayDeps } from './overlay.ts'
import { design } from './test-design.ts'

/** An element as the overlay builds one: its class, data, style and what it holds. */
export interface Fake {
  className: string
  dataset: Record<string, string>
  style: Record<string, string>
  textContent: string
  children: Fake[]
  /** The attributes an SVG element is given. */
  attributes: Record<string, string>
  /** Its size as laid out: every part is 70 × 14 px. */
  offsetWidth: number
  offsetHeight: number
  append(...more: Fake[]): void
}
export const fake = (name = ''): Fake =>
  ({
    className: name,
    dataset: {},
    style: {},
    textContent: '',
    children: [],
    attributes: {},
    offsetWidth: 70,
    offsetHeight: 14,
    append(...more) {
      this.children.push(...more)
    },
    setAttribute(name: string, value: string) {
      this.attributes[name] = value
    },
  }) as Fake
export const SQUARE: Frame = { id: 'one-sq', pageId: 'one', name: 'Sale', x: 0, y: 0, width: 1080, height: 1080 }
export const STORY: Frame = { id: 'one-story', pageId: 'one', name: 'Story', x: 1280, y: 0, width: 1080, height: 1920 }
const MPU: Frame = { id: 'one-mpu', pageId: 'one', name: 'MPU', x: 2560, y: 0, width: 300, height: 250 }
/** A layer's place and size, as BOX's. */
const BOX_PROPS = { x: 10, y: 10, width: 100, height: 100 }
/** The frame each linked copy of `a` on the page is in. */
const COPY_FRAMES = { 'story-a': STORY, 'mpu-a': MPU }
/** The square's layers as its shown scene holds them while hidden layers are shown: `a`, and a hidden `faded` holding a hidden `deep`. */
const HIDDEN_LAYERS = [
  { id: 'a', type: 'graphic', props: GraphicProps.parse({ ...BOX_PROPS, shape: { kind: 'rect' } }), children: [] },
  {
    id: 'faded',
    type: 'group',
    props: GroupProps.parse({ ...BOX_PROPS, visible: false }),
    children: [
      {
        id: 'deep',
        type: 'graphic',
        props: GraphicProps.parse({ ...BOX_PROPS, visible: false, shape: { kind: 'rect' } }),
        children: [],
      },
    ],
  },
]
/** A line's props, 200 long. */
export const LINE = GraphicProps.parse({ x: 0, y: 0, width: 200, height: 0, shape: { kind: 'line' } })
/** A layer whose link id the story, the MPU (off the stage) and a frame of page two hold too. */
export const linkedDesign = (() => {
  const layer = (parentId: string) => ({
    type: 'graphic' as const,
    parentId,
    link: 'a',
    index: 'a0',
    name: 'A',
    props: { x: 10, y: 10, width: 100, height: 100, shape: { kind: 'rect' as const } },
  })
  const parsed = Design.parse({
    ...design,
    nodes: { a: layer('one-sq'), 'story-a': layer('one-story'), 'mpu-a': layer('one-mpu'), 'two-a': layer('two-sq') },
  })
  return parsed
})()
export const BOX: Box = { x: 10, y: 10, width: 100, height: 100, rotation: 0 }
/** The outline path data of the shaped layers, in the boxes they give. */
export const PATHS: Record<string, { d: string; box: { x: number; y: number; width: number; height: number } }> = {
  a: { d: 'M22 10L98 10Q110 10 110 22L110 98Q110 110 98 110L22 110Q10 110 10 98L10 22Q10 10 22 10Z', box: BOX },
  b: { d: 'M10 10L110 60L10 110Z', box: BOX },
  h: { d: 'M60 10A50 50 0 1 1 60 110A50 50 0 1 1 60 10Z', box: BOX },
}

/**
 * The overlay at zoom 1 on a stage 1000 × 800 showing the square frame 100 px down, with a layer
 * selected (or the frame picked instead), a group gone into, a layer hovered and a drop target; each
 * module's parts are one element named for it. Logs each time the overlay puts its parts in place, and
 * keeps what it drew.
 */
export function harness(
  state: {
    gesture?: Gesture | null
    editing?: Picked | null
    selected?: boolean
    picked?: boolean
    lit?: boolean
    renaming?: boolean
    zoom?: number
    /** Where the page's origin is on the stage, across and down. */
    x?: number
    y?: number
    /** The stage's edges floating chrome covers. */
    insets?: { top: number; right: number; bottom: number; left: number }
    /** The design holds linked copies of the selected layer, and the story is in view too. */
    linked?: boolean
    /** The MPU's copy is selected too. */
    across?: boolean
    /**
     * These linked copies of `a` are selected after it, the story's and the MPU's, each drawn at BOX
     * in its frame; the design holds them, and the story and the MPU are in view beside the square.
     */
    copies?: (keyof typeof COPY_FRAMES)[]
    /** The handles the selection has; only `nw` by default. */
    handles?: readonly Handle[]
    /** The selection is one line. */
    line?: boolean
    /** Layers whose outline is other than their box, by id: a rounded `a`, an ellipse `h`. */
    shaped?: boolean
    /** Layer `b` is selected beside `a`. */
    several?: boolean
    /** The hovered layer is lit from outside the stage, as a layers panel row lights it, and none is under the pointer. */
    outside?: boolean
    /** The layer under the pointer, `h` by default. */
    hovered?: string
    /** The selected layer's box, BOX by default. */
    box?: Box
    /** What Alt measures, while it is held. */
    measured?: Measured
    /** The selected layer has two radius dots, and while one is dragged the pill reads "Radius 12". */
    dots?: boolean
    /** Where the pointer is on the stage. */
    pointerAt?: { x: number; y: number }
    /** What picking a colour shows, while it is on. */
    picking?: PickShown
    /** The other people the overlay draws. */
    people?: ShownPerson[]
    /** The picked frame shows handles, as one a press would resize does. */
    frameHandles?: boolean
    /** Hidden layers are shown: the square draws a hidden `faded` holding a hidden `deep`, beside the shown `a`. */
    hidden?: boolean
  } = {},
  /** Changes the modules the overlay is given, as a test of one of its parts needs them. */
  changed: (deps: OverlayDeps) => OverlayDeps = (deps) => deps,
) {
  const log: string[] = []
  let drawn: Fake[] = []
  const editing = state.editing ?? null
  const shown = state.box ?? BOX
  const copies = state.copies ?? []
  const deps: OverlayDeps = {
    overlay: {
      replaceChildren: (...parts: Fake[]) => {
        drawn = parts
        log.push('replace')
      },
    } as unknown as HTMLElement,
    view: {
      camera: () => ({ x: state.x ?? 0, y: state.y ?? 100, zoom: state.zoom ?? 1 }),
      viewport: () => ({ width: 1000, height: 800 }),
      insets: () => state.insets ?? { top: 0, right: 0, bottom: 0, left: 0 },
      design: () => (state.linked || state.copies ? linkedDesign : design),
      inView: () => (state.copies ? [SQUARE, STORY, MPU] : state.linked ? [SQUARE, STORY] : [SQUARE]),
      frameOf: (key) => (key === SQUARE.id ? SQUARE : undefined),
      rulers: () => false,
      safeZones: () => null,
      hiddenShown: () => state.hidden ?? false,
    },
    selection: {
      current: () =>
        state.selected === false
          ? null
          : [
              ...pairsIn('one-sq', state.several ? ['a', 'b'] : ['a']),
              ...(state.across ? pairsIn('one-mpu', ['mpu-a']) : []),
              ...copies.flatMap((id) => pairsIn(COPY_FRAMES[id].id, [id])),
            ],
      entered: () => 'g',
      hovered: () => (state.outside ? null : { id: state.hovered ?? 'h', frameId: 'one-sq' }),
      litLayer: () => (state.outside ? { id: 'h', frameId: 'one-sq' } : null),
      pickedFrame: () => (state.picked ? 'one-sq' : null),
      litFrame: () => (state.lit ? 'one-sq' : null),
      renamingFrame: () => (state.renaming ? 'one-sq' : null),
      pickedSection: () => null,
      renamingSection: () => null,
      cropping: () => null,
      pathEditing: () => null,
      constraintsShown: () => false,
    },
    boxes: {
      selectionBox: () => (state.selected === false ? null : { frame: SQUARE, box: shown, drawn: shown, around: [] }),
      selectionBoxes: () =>
        state.selected === false
          ? []
          : [SQUARE, ...copies.map((id) => COPY_FRAMES[id])].map((frame) => ({
              frame,
              box: shown,
              drawn: shown,
              around: [],
            })),
      drawnBoxOf: () => shown,
      boxIn: () => shown,
      containersOf: () => [],
      handlesFor: () => state.handles ?? ['nw'],
      selectedLine: () => (state.line ? { ends: !state.across, props: LINE } : null),
    },
    scenes: {
      outlinePath: (_frame, id) => (state.shaped && id in PATHS ? (PATHS[id] ?? null) : null),
      shownScene: (frame) => ({
        frameId: frame.id,
        width: frame.width,
        height: frame.height,
        fills: [],
        layers: (state.hidden ? HIDDEN_LAYERS : []) as SceneLayer[],
      }),
    },
    typing: {
      editing: () => editing,
      shown: () => ({ frame: SQUARE, range: [], caret: { x: 10, y: 10, height: 20 } }),
    },
    pen: {
      shown: () => ({
        frame: SQUARE,
        around: [],
        path: [{ anchors: [{ x: 10, y: 10 }], closed: false }],
        handles: [],
        picked: false,
        preview: null,
        closing: false,
      }),
    },
    cropping: {
      shown: () => ({ frame: SQUARE, id: 'photo', window: BOX, whole: BOX, box: BOX, rect: BOX, ghost: 'faint.png' }),
    },
    drawing: { shown: () => ({ kind: 'textBox', frame: SQUARE, rect: BOX }) },
    connecting: { shown: () => ({ dots: [], preview: null, lit: null }) },
    transformDrag: {
      shown: () => ({
        frame: SQUARE,
        around: [],
        snapLines: [{ axis: 'x', at: 10, from: 0, to: 100, points: [] }],
        gaps: [],
      }),
      // The selected layer's two radius dots, the second big while the drag of it runs, with its words.
      shownDots: (g) =>
        !state.dots || (g && g.kind !== 'radius')
          ? { dots: [], label: null }
          : {
              dots: [
                { corner: 0, x: 12, y: 12, big: false },
                { corner: 1, x: 88, y: 12, big: g !== null },
              ],
              label: g ? 'Radius 12' : null,
            },
    },
    autoLayoutDrag: {
      shown: (g) => [{ kind: g ? 'ghost' : 'leave', frame: SQUARE, box: BOX }],
      shownDrop: (frame, drop) => (drop ? [{ kind: 'line', frame, box: BOX }] : []),
    },
    frameResize: { handled: () => (state.frameHandles ? SQUARE : null) },
    place: { dropTarget: () => ({ id: 't', frameId: 'one-sq' }) },
    frameMove: { shownSections: () => ({ outlines: [], lit: null }) },
    pointer: {
      gesture: () => state.gesture ?? null,
      measured: () => state.measured ?? null,
      pointerAt: () => state.pointerAt ?? null,
    },
    colourPick: { shown: () => state.picking ?? null },
    // The rulers hidden: no guide shows.
    guideDrag: { shown: () => [], rulerFrame: () => undefined },
    presence: { shown: () => state.people ?? [] },
  }
  const overlay = editorOverlay(changed(deps))
  /** The part drawn with a class. */
  const part = (className: string) => drawn.find((p) => p.className === className)
  /** Every part drawn with a class. */
  const parts = (className: string) => drawn.filter((p) => p.className === className)
  return { overlay, log, drawn: () => drawn.map((p) => p.className), part, parts }
}
