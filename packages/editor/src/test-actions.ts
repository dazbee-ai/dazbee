// The actions' test fixtures: a page of two frames, the same with layers laid out by auto layout
// and with a text, and the actions over a real session, selection and drags, logging what they ask of the rest.
import { render } from '@dazbee/renderer'
import type { DesignInput } from '@dazbee/schema'

import { type ActionsDeps, editorActions } from './actions.ts'
import { type Frame, pageFrames } from './canvas/frames.ts'
import type { NoticeDetail } from './core-interface.ts'
import { editorFrameActions } from './frame-actions.ts'
import { editorAutoLayoutDrag } from './gestures/select/auto-layout-drag.ts'
import { editorTransformDrag } from './gestures/select/transform-drag.ts'
import { editorBoxLayout } from './layers/box-layout.ts'
import { editorDuplicate } from './layers/duplicate.ts'
import { hug } from './layers/hug.ts'
import { measure, sessionOf, testBoxes, testLaidOut } from './layers/test-boxes.ts'
import { editorReach } from './reach.ts'
import { editorSelection } from './selection.ts'
import type { Tool } from './tools.ts'

const rect = (
  parentId: string,
  index: string,
  box: { x: number; y: number; width: number; height: number },
  extra: Record<string, unknown> = {},
) => ({
  type: 'graphic' as const,
  parentId,
  index,
  name: 'Rect',
  props: { ...box, shape: { kind: 'rect' as const }, ...extra },
})
/**
 * One page with a square frame and a wide one. The square holds three squares in a row with uneven
 * gaps, a layer locked in place, and a row laid out by auto layout holding one square; the wide
 * frame holds a copy of the first square.
 */
export const DESIGN: DesignInput = {
  meta: { designId: 'd', name: 'D' },
  pages: { p1: { name: 'One', order: 'a0' } },
  frames: {
    sq: { pageId: 'p1', name: 'Square', width: 1080, height: 1080, x: 0, y: 0, order: 'a0' },
    wide: { pageId: 'p1', name: 'Wide', width: 1200, height: 628, x: 1280, y: 0, order: 'a1' },
  },
  nodes: {
    a: { ...rect('sq', 'a0', { x: 100, y: 100, width: 100, height: 100 }), link: 'a' },
    b: { ...rect('sq', 'a1', { x: 250, y: 300, width: 100, height: 100 }), link: 'b' },
    c: { ...rect('sq', 'a2', { x: 700, y: 120, width: 100, height: 100 }), link: 'c' },
    pin: { ...rect('sq', 'a3', { x: 700, y: 700, width: 50, height: 50 }), link: 'pin', lock: { move: true } },
    row: {
      type: 'box',
      parentId: 'sq',
      link: 'row',
      index: 'a4',
      name: 'Row',
      props: { x: 100, y: 500, width: 300, height: 100, layout: { direction: 'row' } },
    },
    inRow: { ...rect('row', 'a0', { x: 0, y: 0, width: 50, height: 50 }), link: 'inRow' },
    'wide-a': { ...rect('wide', 'a0', { x: 100, y: 100, width: 100, height: 100 }), link: 'a' },
  },
}
/**
 * The design with a copy of the second square in the wide frame, above the copy of the first, and a
 * third frame on the page, linked to neither, holding two squares of its own.
 */
export const APART: DesignInput = {
  ...DESIGN,
  frames: {
    ...DESIGN.frames,
    apart: { pageId: 'p1', name: 'Apart', width: 400, height: 400, x: 0, y: 2000, order: 'a2' },
  },
  nodes: {
    ...DESIGN.nodes,
    'wide-b': { ...rect('wide', 'a1', { x: 300, y: 100, width: 100, height: 100 }), link: 'b' },
    apartA: { ...rect('apart', 'a0', { x: 100, y: 100, width: 100, height: 100 }), link: 'apartA' },
    apartB: { ...rect('apart', 'a1', { x: 200, y: 200, width: 100, height: 100 }), link: 'apartB' },
  },
}
/** A zigzag path's shape. */
const ZIG = { kind: 'path' as const, d: 'M0 0 L50 0 L50 50' }
/** The names a new group, Mask group and box take, in another language than the schema's defaults. */
const LAYER_NAMES = { group: 'Groupe', maskGroup: 'Groupe de masque', box: 'Boîte' } as const
const PADDED = (pad: number) => ({ top: pad, right: pad, bottom: pad, left: pad })
/**
 * The design with a row laid out by auto layout lower in the square: a fixed square, a square that
 * fills the row's width, and a box hugging one square inside its padding, laid out by auto layout too.
 */
export const FLOW: DesignInput = {
  ...DESIGN,
  nodes: {
    ...DESIGN.nodes,
    flow: {
      type: 'box',
      parentId: 'sq',
      link: 'flow',
      index: 'a5',
      name: 'Flow',
      props: {
        x: 40,
        y: 800,
        width: 560,
        height: 160,
        sizing: { width: 'fixed', height: 'hug' },
        layout: { direction: 'row', gap: 20, padding: PADDED(20) },
      },
    },
    fixed: { ...rect('flow', 'a0', { x: 0, y: 0, width: 120, height: 120 }), link: 'fixed' },
    filling: {
      ...rect('flow', 'a1', { x: 0, y: 0, width: 100, height: 120 }, { sizing: { width: 'fill', height: 'fixed' } }),
      link: 'filling',
    },
    hugging: {
      type: 'box',
      parentId: 'flow',
      link: 'hugging',
      index: 'a2',
      name: 'Hugging',
      props: {
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        sizing: { width: 'hug', height: 'hug' },
        layout: { direction: 'row', gap: 0, padding: PADDED(30) },
      },
    },
    inHug: { ...rect('hugging', 'a0', { x: 0, y: 0, width: 60, height: 60 }), link: 'inHug' },
  },
}

/** The design with a line of text lower in the square, in a box of a fixed size. */
export const WORDS: DesignInput = {
  ...DESIGN,
  nodes: {
    ...DESIGN.nodes,
    words: {
      type: 'text',
      parentId: 'sq',
      link: 'words',
      index: 'a5',
      name: 'Words',
      props: {
        x: 100,
        y: 800,
        width: 600,
        height: 120,
        text: 'Hello there',
        boxMode: 'fixed',
        style: { fontFamily: 'Noto Sans', fontSize: 80, color: '#000000FF' },
      },
    },
  },
}

/** The design with a group turned a quarter in the square, holding one square, and a layer turned 30°. */
export const TURNED: DesignInput = {
  ...DESIGN,
  nodes: {
    ...DESIGN.nodes,
    turned: {
      type: 'group',
      parentId: 'sq',
      link: 'turned',
      index: 'a5',
      name: 'Turned',
      props: { x: 400, y: 800, width: 100, height: 100, rotation: 90 },
    },
    inTurned: { ...rect('turned', 'a0', { x: 400, y: 800, width: 100, height: 100 }), link: 'inTurned' },
    tilt: { ...rect('sq', 'a6', { x: 640, y: 300, width: 160, height: 100 }, { rotation: 30 }), link: 'tilt' },
  },
}

/** The square frame holding photos and paths that are hidden or locked in place. */
export const HIDDEN_PATHS: DesignInput = {
  ...DESIGN,
  nodes: {
    hiddenPhoto: { ...rect('sq', 'a0', { x: 0, y: 0, width: 50, height: 50 }, { visible: false }), link: 'hp' },
    lockedPhoto: { ...rect('sq', 'a1', { x: 0, y: 0, width: 50, height: 50 }), link: 'lp', lock: { move: true } },
    hiddenPath: {
      ...rect('sq', 'a2', { x: 0, y: 0, width: 50, height: 50 }, { visible: false, shape: ZIG }),
      link: 'hpa',
    },
    shut: {
      type: 'group',
      parentId: 'sq',
      link: 'shut',
      index: 'a3',
      name: 'Shut',
      props: { x: 0, y: 0, width: 50, height: 50 },
      lock: { move: true },
    },
    lockedPath: { ...rect('shut', 'a0', { x: 0, y: 0, width: 50, height: 50 }, { shape: ZIG }), link: 'lpa' },
  },
}

/** An image fill. */
const IMAGE = { type: 'image' as const, assetId: 'a1' }
/**
 * The square frame holding a photo, a photo box holding a square, a path, a text, a group holding a
 * square, a hidden photo, a photo locked in place, a photo with its style locked and a second photo.
 */
export const PHOTOS: DesignInput = {
  ...DESIGN,
  nodes: {
    photo: { ...rect('sq', 'a0', { x: 0, y: 0, width: 50, height: 50 }, { fills: [IMAGE] }), link: 'photo' },
    framed: {
      type: 'box',
      parentId: 'sq',
      link: 'framed',
      index: 'a1',
      name: 'Framed',
      props: { x: 100, y: 0, width: 100, height: 100, fills: [IMAGE] },
    },
    inFramed: { ...rect('framed', 'a0', { x: 0, y: 0, width: 50, height: 50 }), link: 'inFramed' },
    zig: { ...rect('sq', 'a2', { x: 0, y: 100, width: 50, height: 50 }, { shape: ZIG }), link: 'zig' },
    words: {
      type: 'text',
      parentId: 'sq',
      link: 'words',
      index: 'a3',
      name: 'Words',
      props: {
        x: 0,
        y: 200,
        width: 200,
        height: 40,
        text: 'Hello',
        boxMode: 'fixed',
        style: { fontFamily: 'Noto Sans', fontSize: 20, color: '#000000FF' },
      },
    },
    group: {
      type: 'group',
      parentId: 'sq',
      link: 'group',
      index: 'a4',
      name: 'Group',
      props: { x: 0, y: 300, width: 50, height: 50 },
    },
    inGroup: { ...rect('group', 'a0', { x: 0, y: 0, width: 50, height: 50 }), link: 'inGroup' },
    hiddenPhoto: {
      ...rect('sq', 'a5', { x: 0, y: 400, width: 50, height: 50 }, { fills: [IMAGE], visible: false }),
      link: 'hiddenPhoto',
    },
    lockedPhoto: {
      ...rect('sq', 'a6', { x: 0, y: 500, width: 50, height: 50 }, { fills: [IMAGE] }),
      link: 'lockedPhoto',
      lock: { move: true },
    },
    styledPhoto: {
      ...rect('sq', 'a7', { x: 0, y: 600, width: 50, height: 50 }, { fills: [IMAGE] }),
      link: 'styledPhoto',
      lock: { style: true },
    },
    photo2: { ...rect('sq', 'a8', { x: 0, y: 700, width: 50, height: 50 }, { fills: [IMAGE] }), link: 'photo2' },
  },
}

/** A text's style at a font size. */
const SIZED = (fontSize: number) => ({ fontFamily: 'Noto Sans', fontSize, fontWeight: 800, color: '#000000FF' })
/**
 * The layers of one of three linked frames, each id after `prefix`: a group holding a mark and a
 * dot, a box laid out in a row holding a call to action, a headline and a badge, with the
 * headline's and the call to action's font sizes and the badge's y as that frame has them.
 */
function linkedLayers(frame: string, prefix: string, sizes: { headline: number; cta: number }, badgeY: number) {
  const id = (name: string) => `${prefix}${name}`
  const text = (parentId: string, index: string, words: string, fontSize: number, width: number) => ({
    type: 'text' as const,
    parentId,
    index,
    name: words,
    props: { x: 80, y: 80, width, height: 150, text: words, style: SIZED(fontSize) },
  })
  const nodes: DesignInput['nodes'] = {
    [id('logo')]: {
      type: 'group',
      parentId: frame,
      link: 'logo',
      index: 'a0',
      name: 'Logo',
      props: { x: 700, y: 800, width: 250, height: 100 },
    },
    [id('mark')]: { ...rect(id('logo'), 'a0', { x: 700, y: 800, width: 100, height: 100 }), link: 'mark' },
    [id('dot')]: { ...rect(id('logo'), 'a1', { x: 850, y: 800, width: 100, height: 100 }), link: 'dot' },
    [id('card')]: {
      type: 'box',
      parentId: frame,
      link: 'card',
      index: 'a1',
      name: 'Card',
      props: { x: 80, y: 400, width: 320, height: 110, layout: { direction: 'row', padding: PADDED(20) } },
    },
    [id('cta')]: { ...text(id('card'), 'a0', 'Shop now', sizes.cta, 220), link: 'cta' },
    [id('headline')]: { ...text(frame, 'a2', 'Summer sale', sizes.headline, 920), link: 'headline' },
    [id('badge')]: { ...rect(frame, 'a3', { x: 600, y: badgeY, width: 300, height: 300 }), link: 'badge' },
  }
  return nodes
}
/**
 * A page of a square, a story and a wide frame, the story and the wide frames holding a linked copy
 * of each of the square's layers, `story-<id>` and `wide-<id>` (see `linkedLayers`): the headline
 * 110 in the square and the story and 72 in the wide frame, the call to action 40, 40 and 34, and
 * the badge at y 330, 1080 and 100.
 */
export const COPIES: DesignInput = {
  meta: { designId: 'd', name: 'D' },
  pages: { p1: { name: 'One', order: 'a0' } },
  frames: {
    sq: { pageId: 'p1', name: 'Square', width: 1080, height: 1080, x: 0, y: 0, order: 'a0' },
    story: { pageId: 'p1', name: 'Story', width: 1080, height: 1920, x: 1280, y: 0, order: 'a1' },
    wide: { pageId: 'p1', name: 'Wide', width: 1200, height: 628, x: 2560, y: 0, order: 'a2' },
  },
  nodes: {
    ...linkedLayers('sq', '', { headline: 110, cta: 40 }, 330),
    ...linkedLayers('story', 'story-', { headline: 110, cta: 40 }, 1080),
    ...linkedLayers('wide', 'wide-', { headline: 72, cta: 34 }, 100),
  },
}
/** A layer of the square with its copies in the story and the wide frame. */
export const everyCopy = (id: string) => [id, `story-${id}`, `wide-${id}`]

/** The actions on a real session, selection and drags over the page's frames, logging what they ask of the view, the tools and the pen. */
export function harness(penDrawing = false, design = DESIGN) {
  const session = sessionOf(design)
  const frames = pageFrames(session.design(), 'p1').frames
  const [frame, wide] = frames as [Frame, Frame]
  const log: string[] = []
  const selection = editorSelection({ drawn: () => session.design(), frames: () => frames, changed: () => {} })
  const boxes = testBoxes(session, selection, frames)
  const scene = (f: Frame) => render(session.design(), f.id, undefined, measure)
  const scenes = { scene, shownScene: scene }
  const hugAll = (ids: string[]) => hug(session, ids)
  const camera = () => ({ x: 0, y: 0, zoom: 1 })
  /** The tool in use, which a tool key or Escape sets. */
  let tool: Tool = 'select'
  /** Logs a notice, a refusal with its reason. */
  const tell = (...told: NoticeDetail) => log.push(told[0] === 'refused' ? `refused ${told[1].why}` : told[0])
  const duplicate = editorDuplicate({ session, selection, boxes, hug: hugAll })
  const autoLayoutDrag = editorAutoLayoutDrag({
    session,
    scenes: testLaidOut(session),
    boxes,
    duplicate,
    selection,
    camera,
    hug: hugAll,
    notify: tell,
    frames: () => frames,
  })
  const transformDrag = editorTransformDrag({
    hold: () => {},
    session,
    scenes,
    selection,
    duplicate,
    typing: { editing: () => null, fitText: () => {} },
    tools: { tool: () => 'select' },
    boxes,
    camera,
    frames: () => frames,
    autoLayoutDrag,
    hug: hugAll,
    notify: () => {},
    radiusLabel: String,
    shownChanged: () => {},
  })
  const boxLayout = editorBoxLayout({ session, boxes, layerName: (kind) => LAYER_NAMES[kind] })
  const frameActions = editorFrameActions({
    session,
    view: {
      page: () => 'p1',
      showWhole: (area) => log.push(`showWhole ${JSON.stringify(area)}`),
      camera: () => ({ x: 0, y: 0, zoom: 1 }),
    },
    tools: { setTool: (tool) => log.push(`tool ${tool}`) },
    frameName: (width, height) => `Size ${width}×${height}`,
    selection,
    typing: { fitText: () => {} },
    rename: (item) => log.push(`rename ${item.kind} ${item.id}`),
    shownChanged: () => log.push('overlay'),
  })
  const deps: ActionsDeps = {
    session,
    view: {
      design: () => session.design(),
      frameOf: (key) => frames.find((f) => f.id === key),
      page: () => 'p1',
      // The wide frame is in the middle of the view.
      nearestFrame: () => wide,
      fitAll: () => log.push('fitAll'),
      fitArea: (area) => log.push(`fitArea ${JSON.stringify(area)}`),
      zoomTo: (zoom) => log.push(`zoomTo ${zoom}`),
      zoomIn: () => log.push('zoomIn'),
      zoomOut: () => log.push('zoomOut'),
      toggleRulers: () => log.push('toggleRulers'),
      viewChanged: () => log.push('viewChanged'),
    },
    tools: {
      tool: () => tool,
      setTool: (next) => {
        tool = next
        log.push(`tool ${next}`)
      },
    },
    selection,
    scenes,
    boxes,
    pen: {
      drawing: () => penDrawing,
      finish: () => log.push('pen finish'),
      deletePoints: () => (log.push('pen deletePoints'), true),
    },
    cropping: {
      start: (_frame, id) => {
        log.push(`crop ${id}`)
        return false
      },
    },
    transformDrag,
    autoLayoutDrag,
    boxLayout,
    frameActions,
    reach: editorReach({
      session,
      selection,
      typing: {
        editing: () => null,
        selectedText: () => null,
        start: (id) => log.push(`type ${id}`),
        selectText: () => log.push('select text'),
      },
    }),
    duplicate,
    notify: tell,
    shownChanged: () => log.push('overlay'),
    layerName: (kind) => LAYER_NAMES[kind],
  }
  const actions = editorActions(deps)
  /** A layer's x and y. */
  const at = (id: string) => {
    const p = session.design().nodes[id]?.props as { x: number; y: number }
    return { x: p.x, y: p.y }
  }
  /** Where each layer of the square is drawn, by id. */
  const drawn = () =>
    Object.fromEntries(
      Object.keys(session.design().nodes)
        .filter((id) => session.design().nodes[id]?.parentId !== 'wide')
        .map((id) => [id, boxes.drawnBoxOf(frame, id)]),
    )
  return {
    actions,
    boxLayout,
    frameActions,
    transformDrag,
    autoLayoutDrag,
    session,
    selection,
    boxes,
    frame,
    wide,
    log,
    at,
    drawn,
  }
}
