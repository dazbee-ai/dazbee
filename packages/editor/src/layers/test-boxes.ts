// Box queries for tests, over a real session: scenes rendered as the editor builds them, text
// measured half its font size a character and 1.2 times it a line, and images of the sizes a test
// gives. A hit test there reads text laid out with the shipped fonts.
import type { Image } from '@dazbee/canvaskit'
import { openSession, type Session } from '@dazbee/doc'
import { openTestStore } from '@dazbee/doc/test-store'
import { type MeasureText, render, type Resources, sceneMemo } from '@dazbee/renderer'
import { type DesignInput, parseDesign } from '@dazbee/schema'

import type { Frame } from '../canvas/frames.ts'
import { hitTest, layersAt } from '../canvas/hit-test.ts'
import { laidOutLayers } from '../canvas/scenes.ts'
import { testLooks } from '../canvas/test-looks.ts'
import type { Size } from '../gestures/crop/crop.ts'
import type { EditorSelection } from '../selection.ts'
import { editorBoxes } from './boxes.ts'

/** Half the font size a character, a line 1.2 times it. */
export const measure: MeasureText = (props) => ({
  width: (props.text.length * props.style.fontSize) / 2,
  height: props.style.fontSize * 1.2,
})

const looks = testLooks()

const rect = (
  parentId: string,
  index: string,
  box: { x: number; y: number; width: number; height: number; rotation?: number },
  extra: Record<string, unknown> = {},
) => ({
  type: 'graphic' as const,
  parentId,
  index,
  name: 'Rect',
  props: { rotation: 0, ...box, shape: { kind: 'rect' as const }, ...extra },
})
export const STYLE = { fontFamily: 'Noto Sans', fontSize: 20, color: '#000000FF' }
/**
 * The square frame's layers: a box holding a dot and a tag, a group turned 90° holding a square, a
 * row laid out by auto layout, a path, a photo with an image fill over a solid one, a layer locked
 * in place, and a text that grows with its words.
 */
const SQUARE_LAYERS: DesignInput['nodes'] = {
  card: {
    type: 'box',
    parentId: 'sq',
    link: 'card',
    index: 'a0',
    name: 'Card',
    props: { x: 100, y: 100, width: 400, height: 300 },
  },
  dot: { ...rect('card', 'a0', { x: 110, y: 120, width: 30, height: 40 }), link: 'dot' },
  tag: { ...rect('card', 'a1', { x: 300, y: 300, width: 20, height: 20 }), link: 'tag' },
  turned: {
    type: 'group',
    parentId: 'sq',
    link: 'turned',
    index: 'a1',
    name: 'Turned',
    props: { x: 600, y: 100, width: 200, height: 200, rotation: 90 },
  },
  inside: { ...rect('turned', 'a0', { x: 600, y: 100, width: 20, height: 20 }), link: 'inside' },
  row: {
    type: 'box',
    parentId: 'sq',
    link: 'row',
    index: 'a2',
    name: 'Row',
    props: { x: 100, y: 500, width: 300, height: 100, layout: { direction: 'row', gap: 10 } },
  },
  a: { ...rect('row', 'a0', { x: 0, y: 0, width: 50, height: 50 }), link: 'a' },
  b: { ...rect('row', 'a1', { x: 0, y: 0, width: 60, height: 50 }), link: 'b' },
  zig: {
    type: 'graphic',
    parentId: 'sq',
    link: 'zig',
    index: 'a3',
    name: 'Zig',
    props: { x: 100, y: 700, width: 100, height: 100, shape: { kind: 'path', d: 'M0 0 L100 0 L100 100' } },
  },
  photo: {
    ...rect(
      'sq',
      'a4',
      { x: 300, y: 700, width: 200, height: 100 },
      {
        fills: [
          { type: 'solid', color: '#FF0000FF' },
          { type: 'image', assetId: 'a1' },
        ],
      },
    ),
    link: 'photo',
  },
  pin: { ...rect('sq', 'a5', { x: 600, y: 700, width: 10, height: 10 }), link: 'pin', lock: { move: true } },
  label: {
    type: 'text',
    parentId: 'sq',
    link: 'label',
    index: 'a6',
    name: 'Label',
    props: { x: 700, y: 700, width: 20, height: 24, text: 'Hi', boxMode: 'autoWidth', style: STYLE },
  },
}
/**
 * One page with a square frame and a wide one. The square holds SQUARE_LAYERS; the wide frame holds
 * a copy of each, `wide-<id>`, linked to it, its dot moved and hidden.
 */
export const DESIGN: DesignInput = {
  meta: { designId: 'd', name: 'D' },
  pages: { p1: { name: 'One', order: 'a0' } },
  frames: {
    sq: { pageId: 'p1', name: 'Square', width: 1080, height: 1080, x: 0, y: 0, order: 'a0' },
    wide: { pageId: 'p1', name: 'Wide', width: 1200, height: 628, x: 1280, y: 0, order: 'a1' },
  },
  nodes: {
    ...SQUARE_LAYERS,
    ...Object.fromEntries(
      Object.entries(SQUARE_LAYERS).map(([id, node]) => [
        `wide-${id}`,
        { ...node, parentId: node.parentId === 'sq' ? 'wide' : `wide-${node.parentId}` },
      ]),
    ),
    'wide-dot': {
      ...rect('wide-card', 'a0', { x: 150, y: 120, width: 30, height: 40 }, { visible: false }),
      link: 'dot',
    },
  },
}

/** A session over a design, which must parse. */
export function sessionOf(input: DesignInput): Session {
  const parsed = parseDesign(input)
  if (!parsed.success) throw new Error(parsed.errors.join('\n'))
  return openSession(openTestStore(parsed.design))
}

/**
 * The box queries over a session and selection, in the frames given, with images of these sizes by
 * asset id, text measured by `measuring`, at the camera's `zoom`.
 */
export function testBoxes(
  session: Session,
  selection: Pick<EditorSelection, 'current' | 'entered'>,
  frames: Frame[],
  images: Record<string, Size> = {},
  measuring: MeasureText = measure,
  zoom: () => number = () => 1,
  /** The own size of each image given smaller in `images`, as a display copy. */
  own: Record<string, Size> = {},
) {
  const decoded = new Map(
    Object.entries(images).map(([id, size]) => [id, { width: () => size.width, height: () => size.height } as Image]),
  )
  const memo = sceneMemo()
  const laid = testLaidOut(session, measuring, memo)
  return editorBoxes({
    session,
    scenes: {
      scene: (frame) => render(session.design(), frame.id, undefined, measuring),
      laidOut: laid.laidOut,
      laidOutLayer: laid.laidOutLayer,
      hit: (frame, p, options) =>
        hitTest(render(session.design(), frame.id, undefined, measuring).layers, p, looks, options),
      under: (frame, p, options) =>
        layersAt(render(session.design(), frame.id, undefined, measuring).layers, p, looks, options),
    },
    resources: {
      resources: () => ({ images: decoded, imageSizes: new Map(Object.entries(own)) }) as unknown as Resources,
      bytes: () => ({ fonts: [], fallbackFamilies: [], images: {} }),
    },
    selection,
    drawn: () => session.design(),
    frameOf: (key) => frames.find((f) => f.id === key),
    zoom,
  })
}

/** A session's frames laid out as the editor keeps them (`laidOutLayers`), text measured by `measuring`. */
export function testLaidOut(session: Session, measuring: MeasureText = measure, memo = sceneMemo()) {
  return laidOutLayers({
    build: (frameId, design) => render(design, frameId, memo, measuring).layers,
    live: () => session.design(),
    changes: () => session.changes(),
  })
}

/**
 * Puts a layer in a new group, `moved`, inside a new row laid out at 600, 600 in its frame: the row
 * draws the group in its slot, 500 right and 500 down of where a layer stored at 100, 100 is kept.
 */
export function groupMovedByRow(session: Session, id: string, frameId: string) {
  session.run('node.create', {
    id: 'row',
    parentId: frameId,
    layer: {
      type: 'box',
      name: 'Row',
      props: { x: 600, y: 600, width: 400, height: 300, layout: { direction: 'row' } },
    },
  })
  session.run('node.group', { ids: [id], id: 'moved' })
  session.run('node.move', { id: 'moved', parentId: 'row' })
  return 'moved'
}
