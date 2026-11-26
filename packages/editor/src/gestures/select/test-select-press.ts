// The select tool press's test fixtures: a square frame with a box holding a dot, its variants, and
// the press over a real session, selection and box queries that logs what it asks of the drags.
import { render } from '@dazbee/renderer'
import type { DesignInput, Point } from '@dazbee/schema'

import type { Frame } from '../../canvas/frames.ts'
import { hitTest } from '../../canvas/hit-test.ts'
import { testLooks } from '../../canvas/test-looks.ts'
import { measure, sessionOf, testBoxes } from '../../layers/test-boxes.ts'
import { isCorner } from '../../layers/transform.ts'
import { editorSelection } from '../../selection.ts'
import { onMac } from '../../test-platform.ts'
import type { Grab } from '../hit-zones.ts'
import { pointerInput } from '../test-inputs.ts'
import { editorFrameMove } from './frame-move.ts'
import type { MoveDrag } from './move-drag.ts'
import type { ResizeDrag } from './resize-drag.ts'
import { editorSectionMove } from './section-move.ts'
import { editorSelectPress, type SelectPressDeps } from './select-press.ts'

const rect = (parentId: string, index: string, box: { x: number; y: number; width: number; height: number }) => ({
  type: 'graphic' as const,
  parentId,
  index,
  name: 'Rect',
  props: { rotation: 0, ...box, shape: { kind: 'rect' as const } },
})
/** A box holding a dot, a square beside it, and a pin locked in place, in one square frame. */
export const DESIGN: DesignInput = {
  meta: { designId: 'd', name: 'D' },
  pages: { p1: { name: 'One', order: 'a0' } },
  frames: { sq: { pageId: 'p1', name: 'Square', width: 1080, height: 1080, x: 0, y: 0, order: 'a0' } },
  nodes: {
    card: {
      type: 'box',
      parentId: 'sq',
      link: 'card',
      index: 'a0',
      name: 'Card',
      props: { x: 100, y: 100, width: 400, height: 300 },
    },
    dot: { ...rect('card', 'a0', { x: 110, y: 120, width: 30, height: 40 }), link: 'dot' },
    box: { ...rect('sq', 'a1', { x: 600, y: 100, width: 100, height: 100 }), link: 'box' },
    pin: { ...rect('sq', 'a2', { x: 600, y: 700, width: 10, height: 10 }), link: 'pin', lock: { move: true } },
  },
}
/** The design with a round layer over the pin, its box's corner on the pin, where the round doesn't show. */
export const ROUND_OVER_PIN: DesignInput = {
  ...DESIGN,
  nodes: {
    ...DESIGN.nodes,
    pin: { ...rect('sq', 'a2', { x: 580, y: 680, width: 10, height: 10 }), link: 'pin', lock: { move: true } },
    round: {
      ...rect('sq', 'a3', { x: 580, y: 680, width: 100, height: 100 }),
      props: { rotation: 0, x: 580, y: 680, width: 100, height: 100, shape: { kind: 'ellipse' as const } },
      link: 'round',
    },
  },
}
/** The design with a round layer on the card, its box's corner over the card, where the round doesn't show. */
export const ROUND_OVER_CARD: DesignInput = {
  ...DESIGN,
  nodes: {
    ...DESIGN.nodes,
    round: {
      ...rect('sq', 'a3', { x: 300, y: 200, width: 100, height: 100 }),
      props: { rotation: 0, x: 300, y: 200, width: 100, height: 100, shape: { kind: 'ellipse' as const } },
      link: 'round',
    },
  },
}
/** The design with the pin, filled, over the dot in the card: a layer locked in place over a box's layer. */
export const PIN_ON_DOT: DesignInput = {
  ...DESIGN,
  nodes: {
    ...DESIGN.nodes,
    pin: {
      ...rect('sq', 'a2', { x: 100, y: 110, width: 60, height: 60 }),
      props: {
        rotation: 0,
        x: 100,
        y: 110,
        width: 60,
        height: 60,
        shape: { kind: 'rect' as const },
        fills: [{ type: 'solid' as const, color: '#444444FF' }],
      },
      link: 'pin',
      lock: { move: true },
    },
  },
}
/** The design with a group under the card holding an ellipse that masks a rect, both as big as the group. */
export const MASKED: DesignInput = {
  ...DESIGN,
  nodes: {
    ...DESIGN.nodes,
    masked: {
      type: 'group',
      parentId: 'sq',
      link: 'masked',
      index: 'a3',
      name: 'Masked',
      props: { x: 100, y: 600, width: 400, height: 300 },
    },
    mask: {
      ...rect('masked', 'a0', { x: 100, y: 600, width: 400, height: 300 }),
      props: {
        rotation: 0,
        x: 100,
        y: 600,
        width: 400,
        height: 300,
        shape: { kind: 'ellipse' as const },
        fills: [{ type: 'solid' as const, color: '#000000FF' }],
        mask: 'alpha' as const,
      },
      link: 'mask',
    },
    photo: {
      ...rect('masked', 'a1', { x: 100, y: 600, width: 400, height: 300 }),
      props: {
        rotation: 0,
        x: 100,
        y: 600,
        width: 400,
        height: 300,
        shape: { kind: 'rect' as const },
        fills: [{ type: 'solid' as const, color: '#00A88AFF' }],
      },
      link: 'photo',
    },
  },
}
/** The design with a group `pair` in the card, holding `left` and `right`. */
export const NESTED: DesignInput = {
  ...DESIGN,
  nodes: {
    ...DESIGN.nodes,
    pair: {
      type: 'group',
      parentId: 'card',
      link: 'pair',
      index: 'a1',
      name: 'Pair',
      props: { x: 200, y: 200, width: 150, height: 50 },
    },
    left: { ...rect('pair', 'a0', { x: 200, y: 200, width: 50, height: 50 }), link: 'left' },
    right: { ...rect('pair', 'a1', { x: 300, y: 200, width: 50, height: 50 }), link: 'right' },
  },
}
/** The design with the card laid out by auto layout in a row, and a column laid out too, holding `mark`. */
export const FLOWS: DesignInput = {
  ...DESIGN,
  nodes: {
    ...DESIGN.nodes,
    card: { ...DESIGN.nodes.card, props: { ...DESIGN.nodes.card?.props, layout: { direction: 'row' } } },
    column: {
      type: 'box',
      parentId: 'sq',
      link: 'column',
      index: 'a3',
      name: 'Column',
      props: { x: 600, y: 300, width: 200, height: 200, layout: { direction: 'column' } },
    },
    mark: { ...rect('column', 'a0', { x: 0, y: 0, width: 50, height: 50 }), link: 'mark' },
  } as DesignInput['nodes'],
}
export const SQUARE: Frame = { id: 'sq', pageId: 'p1', name: 'Square', x: 0, y: 0, width: 1080, height: 1080 }
/** The design with a second frame beside the square, holding a linked copy of the square's box and a layer of its own. */
export const LINKED: DesignInput = {
  ...DESIGN,
  frames: {
    ...DESIGN.frames,
    tall: { pageId: 'p1', name: 'Tall', width: 1080, height: 1920, x: 1280, y: 0, order: 'a1' },
  },
  nodes: {
    ...DESIGN.nodes,
    'tall-box': { ...rect('tall', 'a0', { x: 600, y: 100, width: 100, height: 100 }), link: 'box' },
    own: { ...rect('tall', 'a1', { x: 100, y: 800, width: 100, height: 100 }), link: 'own' },
  },
}
/** The linked design with the tall frame's copy of the box locked in place. */
export const LOCKED_COPY: DesignInput = {
  ...LINKED,
  nodes: {
    ...LINKED.nodes,
    'tall-box': { ...LINKED.nodes['tall-box'], lock: { move: true } } as DesignInput['nodes'][string],
  },
}
/** The design with the square's box turned 45°, a diamond inside its unturned box. */
export const TURNED: DesignInput = {
  ...DESIGN,
  nodes: {
    ...DESIGN.nodes,
    box: {
      ...rect('sq', 'a1', { x: 600, y: 100, width: 100, height: 100 }),
      props: { x: 600, y: 100, width: 100, height: 100, rotation: 45, shape: { kind: 'rect' as const } },
      link: 'box',
    },
  },
}
/** The design with a 300 × 12 caption, a 300 × 12 ellipse and a 300 × 1 rule under the square's layers. */
export const THIN: DesignInput = {
  ...DESIGN,
  nodes: {
    ...DESIGN.nodes,
    caption: {
      type: 'text',
      parentId: 'sq',
      link: 'caption',
      index: 'a4',
      name: 'Caption',
      props: {
        x: 100,
        y: 800,
        width: 300,
        height: 12,
        text: 'A caption three hundred wide',
        boxMode: 'fixed',
        style: { fontFamily: 'Noto Sans', fontSize: 10, color: '#000000FF' },
      },
    },
    oval: {
      ...rect('sq', 'a5', { x: 100, y: 900, width: 300, height: 12 }),
      props: { rotation: 0, x: 100, y: 900, width: 300, height: 12, shape: { kind: 'ellipse' as const } },
      link: 'oval',
    },
    rule: { ...rect('sq', 'a6', { x: 100, y: 1000, width: 300, height: 1 }), link: 'rule' },
  },
}
export const TALL: Frame = { id: 'tall', pageId: 'p1', name: 'Tall', x: 1280, y: 0, width: 1080, height: 1920 }
const looks = testLooks()

/**
 * The select tool's press over the design on a real session, selection and box queries, at zoom 1
 * with the frame at the canvas's corner, so screen points are design pixels. Logs what it asks of
 * the drags and typing, and when it holds the pointer.
 */
export function harness(handle: ResizeDrag['handle'] | Grab | null = null, design = DESIGN) {
  const session = sessionOf(design)
  const frames = design === DESIGN ? [SQUARE] : [SQUARE, TALL]
  const log: string[] = []
  const selection = editorSelection({ drawn: () => session.design(), frames: () => frames, changed: () => {} })
  const boxes = testBoxes(session, selection, frames)
  const view = {
    camera: () => ({ x: 0, y: 0, zoom: 1 }),
    design: () => session.design(),
    frames: () => frames,
  }
  const deps: SelectPressDeps = {
    hold: () => log.push('hold'),
    session,
    view: {
      camera: () => ({ x: 0, y: 0, zoom: 1 }),
      design: () => session.design(),
      frames: () => frames,
      frameOf: (key) => frames.find((f) => f.id === key),
      pointOn: (screen) => {
        const frame = frames.find((f) => screen.x >= f.x && screen.x <= f.x + f.width && screen.y <= f.height)
        return frame && screen.y >= 0 ? { frame, p: { x: screen.x - frame.x, y: screen.y - frame.y } } : null
      },
    },
    selection,
    boxes,
    typing: { stop: () => log.push('stop typing') },
    transformDrag: {
      handleUnder: () => (typeof handle === 'string' ? { kind: 'resize', handle, drawn: isCorner(handle) } : handle),
      pressHandle: (_e, _screen, grab) => {
        log.push(`press handle ${grab.kind}`)
        return { kind: 'resize' } as ResizeDrag
      },
      pressMove: (frame, _around, _p, ids, others = []) => {
        const along = others.map((o) => ` + ${o.frame.id}: ${o.ids.join(' ')}`).join('')
        log.push(`press move ${frame === SQUARE ? '' : `${frame.id}: `}${ids.join(' ')}${along}`)
        return { kind: 'move' } as MoveDrag
      },
    },
    // The dot alone is taken as a layer a flow places, for the drag a press on it would start.
    autoLayoutDrag: { press: () => null, reorders: (ids) => ids.length === 1 && ids[0] === 'dot' },
    frameMove: editorFrameMove({ session, view }),
    sectionMove: editorSectionMove({ session }),
    // No frame is picked with handles: no press resizes one.
    frameResize: { press: () => null },
    onMac,
  }
  const select = editorSelectPress(deps)
  /** A press at a point, with Shift, Ctrl and ⌘ held when asked, on the layer a press there finds. */
  const press = (p: Point, shiftKey = false, ctrlKey = false, metaKey = false) => {
    const deepest = hitTest(render(session.design(), 'sq', undefined, measure).layers, p, looks, {
      pickable: boxes.pickable,
    })
    return select.press(pointerInput({ shiftKey, ctrlKey, metaKey }), p, { frame: SQUARE, p }, deepest)
  }
  /** A press at a point of a frame, in its design pixels, with Shift held when asked. */
  const pressIn = (frame: Frame, p: Point, shiftKey = false) => {
    const deepest = hitTest(render(session.design(), frame.id, undefined, measure).layers, p, looks, {
      pickable: boxes.pickable,
    })
    const screen = { x: frame.x + p.x, y: frame.y + p.y }
    return select.press(pointerInput({ shiftKey }), screen, { frame, p }, deepest)
  }
  /** A press off every frame, on empty canvas. */
  const pressOff = (p: Point, shiftKey = false) => select.press(pointerInput({ shiftKey }), p, null, null)
  return { select, selection, press, pressIn, pressOff, log }
}
