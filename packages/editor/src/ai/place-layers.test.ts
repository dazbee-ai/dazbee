import { describe, expect, it } from 'vitest'

import { childrenOf, openSession } from '@dazbee/doc'
import { openTestStore } from '@dazbee/doc/test-store'
import { type AiFrameView, type DesignInput, pictureLayerOf, UnplacedLayer } from '@dazbee/schema'

import { type PlacedLayer, placeLayers } from './place-layers.ts'

/** A design of one 1080 px frame whose picture layer shows picture `pic1`, filling it. */
const design = (): DesignInput => ({
  meta: { designId: 'd1', name: 'Test' },
  pages: { p1: { name: 'Page 1', order: 'a0' } },
  frames: {
    f1: { pageId: 'p1', name: 'Draft 1', width: 1080, height: 1080, x: 0, y: 0, fills: [], order: 'a0' },
  },
  nodes: {
    [pictureLayerOf('f1')]: {
      type: 'graphic',
      parentId: 'f1',
      link: 'picture',
      index: 'a0',
      name: 'Picture',
      props: {
        x: 0,
        y: 0,
        width: 1080,
        height: 1080,
        shape: { kind: 'rect' },
        fills: [{ type: 'image', assetId: 'pic1', fit: 'fill' }],
      },
    },
  },
})

/** The frame as a tab reads it once job `job1` has split its picture. */
const FRAME: AiFrameView = {
  frameId: 'f1',
  briefId: null,
  jobId: 'job1',
  callIndex: 1,
  kind: 'draft',
  state: 'layering',
  assetId: 'pic1',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

/** A rectangle as the shape matcher answers it, placed in the frame. */
const rect = (x: number, y: number, width: number, height: number) =>
  UnplacedLayer.parse({
    type: 'graphic',
    name: 'Rectangle',
    props: { x, y, width, height, shape: { kind: 'rect' }, fills: [{ type: 'solid', color: '#FF0000FF' }] },
  })

/** A text as the text matcher answers it, placed in the frame. */
const text = () =>
  UnplacedLayer.parse({
    type: 'text',
    name: 'Big sale',
    props: {
      x: 100,
      y: 50,
      width: 200,
      height: 60,
      text: 'Big sale',
      boxMode: 'autoWidth',
      style: { fontFamily: 'Inter', fontWeight: 700, fontSize: 48, color: '#111111FF' },
    },
  })

/** Split piece `n` of the frame as the finish places it: a picture layer, or the layers `matched` rebuilt it as. */
const pieceLayer = (n: number, name: string, matched?: UnplacedLayer[]): PlacedLayer => ({
  id: `job1-f1-${n}`,
  link: null,
  name,
  assetId: `cut-${n}`,
  box: { x: 0, y: 0, width: 1080, height: 1080 },
  ...(matched
    ? {
        matched: matched.map((layer, nth) => ({ id: nth === 0 ? `job1-f1-${n}` : `job1-f1-${n}_${nth}`, layer })),
        group: `job1-f1-${n}_group`,
      }
    : {}),
})

/** A session on the design, with what places layers in it and the texts it was asked to fit. */
function placing() {
  const session = openSession(openTestStore(design()))
  const fitted: string[] = []
  return { session, fitted, ...placeLayers({ session, fitText: (id) => fitted.push(id) }) }
}

/** The layers of `parentId`, bottom first: each one's id, type and name. */
const layersIn = (session: ReturnType<typeof placing>['session'], parentId: string) =>
  childrenOf(session.design(), parentId).map(([id, layer]) => [id, layer.type, layer.name])

describe('placeLayers', () => {
  it('puts the several layers a piece was rebuilt as in one group named after the piece, where they were placed', () => {
    const { session, place } = placing()
    // Front to back: a headline, a badge rebuilt as two graphics, and the backdrop.
    place(FRAME, [
      pieceLayer(0, 'Headline', [text()]),
      pieceLayer(1, 'Badge', [rect(540, 540, 135, 135), rect(574, 574, 67, 67)]),
      pieceLayer(2, 'Backdrop'),
    ])

    expect(layersIn(session, 'f1')).toEqual([
      [pictureLayerOf('f1'), 'graphic', 'Picture'],
      ['job1-f1-2', 'graphic', 'Backdrop'],
      ['job1-f1-1_group', 'group', 'Badge'],
      ['job1-f1-0', 'text', 'Headline'],
    ])
    expect(layersIn(session, 'job1-f1-1_group')).toEqual([
      ['job1-f1-1', 'graphic', 'Badge 1'],
      ['job1-f1-1_1', 'graphic', 'Badge 2'],
    ])
    // The group hugs its layers, which stay where they were placed in the frame.
    const { nodes } = session.design()
    expect(nodes['job1-f1-1_group']?.props).toMatchObject({ x: 540, y: 540, width: 135, height: 135 })
    expect(nodes['job1-f1-1']?.props).toMatchObject({ x: 540, y: 540, width: 135, height: 135 })
    expect(nodes['job1-f1-1_1']?.props).toMatchObject({ x: 574, y: 574, width: 67, height: 67 })
  })

  it('places a piece rebuilt as one layer with no group, named after the piece, a text fitted to its words', () => {
    const { session, place, fitted } = placing()
    place(FRAME, [pieceLayer(0, 'Headline', [text()]), pieceLayer(1, 'Badge', [rect(540, 540, 135, 135)])])

    expect(layersIn(session, 'f1')).toEqual([
      [pictureLayerOf('f1'), 'graphic', 'Picture'],
      ['job1-f1-1', 'graphic', 'Badge'],
      ['job1-f1-0', 'text', 'Headline'],
    ])
    expect(Object.values(session.design().nodes).some((layer) => layer.type === 'group')).toBe(false)
    expect(fitted).toEqual(['job1-f1-0'])
  })

  it('makes the group in the step its layers are placed in: one undo takes back the layers and the group', () => {
    const { session, place } = placing()
    const step = session.beginGesture()
    place(FRAME, [pieceLayer(0, 'Badge', [rect(0, 0, 10, 10), rect(2, 2, 4, 4), rect(3, 3, 2, 2)])])
    step.end()
    expect(layersIn(session, 'job1-f1-0_group')).toHaveLength(3)

    session.undo()
    expect(layersIn(session, 'f1')).toEqual([[pictureLayerOf('f1'), 'graphic', 'Picture']])
    expect(session.design().nodes[pictureLayerOf('f1')]?.props.visible).not.toBe(false)
    expect(session.canUndo()).toBe(false)
  })

  it('gives the first layer of a group the piece’s link id, and places nothing where an earlier finish placed', () => {
    const { session, place } = placing()
    const badge = { ...pieceLayer(0, 'Badge', [rect(0, 0, 10, 10), rect(2, 2, 4, 4)]), link: 'job1-badge' }
    place(FRAME, [badge])
    const { nodes } = session.design()
    expect(nodes['job1-f1-0']?.link).toBe('job1-badge')
    expect(nodes['job1-f1-0_1']?.link).not.toBe('job1-badge')
    expect(nodes['job1-f1-0_group']?.link).not.toBe('job1-badge')

    place(FRAME, [badge, pieceLayer(1, 'Backdrop')])
    expect(layersIn(session, 'f1')).toHaveLength(2)
  })
})
