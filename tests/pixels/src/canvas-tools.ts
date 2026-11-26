import { type DesignInput, FRAME_GAP } from '@dazbee/schema'

/** How many frames each section of the canvas-tools page holds, in a row. */
const FRAMES_PER_SECTION = 10
/** The side of each square frame. */
const SIDE = 1080

const order = (i: number) => `a${i.toString(36).padStart(2, '0')}`

/**
 * A page of the canvas tools at their full weight, for the open-time check: `sections` sections
 * (`s<n>`), each a row of ten square frames (`s<n>-f<m>`) holding a background, a title and a
 * button, the rows stacked FRAME_GAP and a title row apart. 200 connectors join them: each frame to
 * the next in its row, each section to the next, and the last frame back to the first section. Every
 * row's first frame is starred.
 */
export function canvasTools(sections = 20): DesignInput {
  const frames: DesignInput['frames'] = {}
  const nodes: DesignInput['nodes'] = {}
  const sectionRecords: NonNullable<DesignInput['sections']> = {}
  const connectors: NonNullable<DesignInput['connectors']> = {}
  const connect = (from: string, to: string) => {
    const n = Object.keys(connectors).length
    connectors[`c${n}`] = { pageId: 'p1', from, to, order: order(n) }
  }
  for (let s = 1; s <= sections; s++) {
    const sectionId = `s${s}`
    sectionRecords[sectionId] = { pageId: 'p1', title: `Brief ${s}`, order: order(s) }
    for (let m = 1; m <= FRAMES_PER_SECTION; m++) {
      const frameId = `${sectionId}-f${m}`
      frames[frameId] = {
        pageId: 'p1',
        name: `Draft ${m}`,
        width: SIDE,
        height: SIDE,
        x: (m - 1) * (SIDE + FRAME_GAP),
        y: (s - 1) * (SIDE + 2 * FRAME_GAP),
        fills: [{ type: 'solid', color: '#FFFFFFFF' }],
        order: order((s - 1) * FRAMES_PER_SECTION + m),
        sectionId,
        ...(m === 1 && { starred: true as const }),
      }
      for (const [key, layer] of Object.entries(draftLayers(frameId))) nodes[`${frameId}-${key}`] = layer
      if (m > 1) connect(`${sectionId}-f${m - 1}`, frameId)
    }
    if (s > 1) connect(`s${s - 1}`, sectionId)
  }
  connect(`s${sections}-f${FRAMES_PER_SECTION}`, 's1')
  return {
    meta: { designId: 'canvas-tools', name: 'Canvas tools' },
    pages: { p1: { name: 'Briefs', order: 'a0' } },
    frames,
    nodes,
    sections: sectionRecords,
    connectors,
  }
}

/** A draft's three layers in frame `frameId`: a background, a title and a button. */
function draftLayers(frameId: string): Record<string, DesignInput['nodes'][string]> {
  const at = (key: string, index: string) => ({ parentId: frameId, link: `${frameId}-${key}`, index })
  return {
    bg: {
      type: 'graphic',
      ...at('bg', 'a0'),
      name: 'Background',
      props: {
        x: 0,
        y: 0,
        width: SIDE,
        height: SIDE,
        shape: { kind: 'rect' },
        fills: [{ type: 'solid', color: '#ECEFF1FF' }],
      },
    },
    title: {
      type: 'text',
      ...at('title', 'a1'),
      name: 'Title',
      role: 'headline',
      props: {
        x: 80,
        y: 120,
        width: 920,
        height: 200,
        text: 'Summer sale',
        style: { fontFamily: 'Noto Sans', fontSize: 96, color: '#111111FF', fontWeight: 700 },
      },
    },
    cta: {
      type: 'graphic',
      ...at('cta', 'a2'),
      name: 'Button',
      props: {
        x: 80,
        y: 880,
        width: 360,
        height: 120,
        shape: { kind: 'rect' },
        fills: [{ type: 'solid', color: '#FF5A36FF' }],
      },
    },
  }
}
