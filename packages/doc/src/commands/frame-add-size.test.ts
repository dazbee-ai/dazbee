import { describe, expect, it } from 'vitest'

import {
  type Design,
  type DesignInput,
  type Layer,
  readableTextSize,
  type Rect,
  SIZE_PRESETS,
  smallestLetters,
  type TextProps,
} from '@dazbee/schema'

import { readDesign } from '../index.ts'
import { openTestSession } from '../test-design.ts'
import { openTestStore } from '../test-store.ts'

type NodeInput = DesignInput['nodes'][string]

const STYLE = { fontFamily: 'Noto Sans', fontSize: 60, color: '#111111FF' }
const CROP_PHOTO = [{ type: 'image', assetId: 'photo', fit: 'crop', opacity: 1 }]
const LOCKED = { move: true, resize: true, content: true, style: true, delete: true }
/** The six sizes the sample ad is added at. */
const SIZES = [
  [1080, 1920],
  [1200, 628],
  [1080, 1350],
  [300, 250],
  [728, 90],
  [160, 600],
] as const

let order = 0
/** A layer of `type` under `parentId` at x, y, width and height, its link its id, with more props and fields. */
const layer = (
  id: string,
  parentId: string,
  type: 'graphic' | 'text' | 'box' | 'group',
  [x, y, width, height]: [number, number, number, number],
  props: Record<string, unknown> = {},
  more: Record<string, unknown> = {},
): [string, NodeInput] => {
  order += 1
  const own =
    type === 'graphic'
      ? { shape: { kind: 'rect' } }
      : type === 'text'
        ? { text: id, boxMode: 'autoHeight', style: STYLE }
        : {}
  const node = {
    type,
    parentId,
    link: id,
    index: `a${order}`,
    name: id,
    props: { x, y, width, height, ...own, ...props },
  }
  return [id, { ...node, ...more } as NodeInput]
}

/** A design whose one page holds the 1080 square frame `sq`, holding `nodes`. */
const adOf = (nodes: Record<string, NodeInput>): DesignInput => ({
  meta: { designId: 'd1', name: 'Ad' },
  pages: { p1: { name: 'Page 1', order: 'a0' } },
  frames: { sq: { pageId: 'p1', name: 'Square', width: 1080, height: 1080, x: 0, y: 0, order: 'a0' } },
  nodes,
})

/**
 * The sample ad, in the 1080 square frame `sq`: a photo behind everything, a logo top left, a badge
 * top right, a headline, a product, a button at the bottom middle and small print at the foot.
 * `changes` adds props and fields to its layers, by id.
 */
const sampleAd = (
  changes: Record<string, { props?: Record<string, unknown>; more?: Record<string, unknown> }> = {},
): DesignInput => {
  const layers: [string, 'graphic' | 'text', [number, number, number, number], object?][] = [
    ['photo', 'graphic', [0, 0, 1080, 1080]],
    ['logo', 'graphic', [60, 60, 200, 80]],
    ['badge', 'graphic', [860, 60, 160, 160], { shape: { kind: 'ellipse' } }],
    ['headline', 'text', [90, 260, 900, 160]],
    ['product', 'graphic', [340, 440, 400, 400], { shape: { kind: 'path', d: 'M0 0L400 400' } }],
    ['button', 'graphic', [390, 880, 300, 90]],
    ['legal', 'text', [90, 1000, 900, 40]],
  ]
  return adOf(
    Object.fromEntries(
      layers.map(([id, type, box, props]) =>
        layer(id, 'sq', type, box, { ...props, ...changes[id]?.props }, changes[id]?.more),
      ),
    ),
  )
}

/** Adds a size of `sq` to the design: the design after, and the copy of each layer by its original's id. */
function addSize(input: DesignInput, width: number, height: number) {
  const store = openTestStore(input)
  const tab = openTestSession(store)
  const before = readDesign(store)
  const frameId = tab.run('frame.addSize', { frameId: 'sq', width, height })
  const design = readDesign(store)
  const copies = new Map(
    Object.values(design.nodes)
      .filter((node) => node !== design.nodes[node.link])
      .map((node) => [node.link, node]),
  )
  const copy = (id: string) => copies.get(id) as Layer
  const box = (id: string): Rect => {
    const { x, y, width: w, height: h } = copy(id).props
    return { x, y, width: w, height: h }
  }
  return { store, tab, before, design, frameId, copy, box }
}

/**
 * An ad of texts in the 1080 square, each readable there: a headline, a subline whose first word is
 * set smaller, small print in a fixed box, and a price that shrinks to fit.
 */
const textAd = (): DesignInput =>
  adOf(
    Object.fromEntries([
      layer('headline', 'sq', 'text', [90, 200, 900, 180], {
        text: 'Big summer sale',
        style: { ...STYLE, fontSize: 72 },
      }),
      layer('subline', 'sq', 'text', [90, 400, 600, 50], {
        text: 'Only this week',
        style: { ...STYLE, fontSize: 40 },
        runs: [{ start: 0, end: 4, style: { fontSize: 34 } }],
      }),
      layer('legal', 'sq', 'text', [90, 1000, 900, 40], {
        text: 'Terms apply',
        boxMode: 'fixed',
        style: { ...STYLE, fontSize: 34 },
      }),
      layer('price', 'sq', 'text', [640, 600, 340, 120], {
        text: '$49',
        boxMode: 'fixed',
        style: { ...STYLE, fontSize: 80 },
        shrinkToFit: { min: 36, max: 80 },
      }),
    ]),
  )
/** The size a text's smallest letters are drawn at, at the least its shrink to fit allows. */
const smallestDrawn = (props: TextProps) =>
  smallestLetters(props, props.shrinkToFit ? props.shrinkToFit.min / props.style.fontSize : 1)?.size ?? 0

const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
const inside = (b: Rect, width: number, height: number) =>
  b.x >= -0.01 && b.y >= -0.01 && b.x + b.width <= width + 0.01 && b.y + b.height <= height + 0.01
const boxOf = (design: Design, id: string): Rect => {
  const { x, y, width, height } = (design.nodes[id] as Layer).props
  return { x, y, width, height }
}

describe('frame.addSize', () => {
  describe.each(SIZES)('the sample ad at %i × %i', (width, height) => {
    const ids = ['photo', 'logo', 'badge', 'headline', 'product', 'button', 'legal']

    it('keeps every layer in the frame, overlaps none that did not overlap in the square but a text raised to the readable size, and fills it with the photo', () => {
      const { before, box, copy } = addSize(sampleAd(), width, height)
      // A text set larger than the scale sets it takes more room than the scale leaves it.
      const raised = (id: string) =>
        copy(id).type === 'text' &&
        (copy(id).props as TextProps).style.fontSize > (60 * Math.min(width, height)) / 1080 + 0.01
      for (const id of ids) expect(inside(box(id), width, height), id).toBe(true)
      for (const a of ids)
        for (const b of ids)
          if (a < b && !raised(a) && !raised(b) && overlaps(box(a), box(b)))
            expect(overlaps(boxOf(before, a), boxOf(before, b)), `${a} and ${b}`).toBe(true)
      expect(box('photo')).toEqual({ x: 0, y: 0, width, height })
    })

    it('fills it with the photo while the photo is locked', () => {
      const { box } = addSize(sampleAd({ photo: { more: { lock: LOCKED } } }), width, height)
      expect(box('photo')).toEqual({ x: 0, y: 0, width, height })
    })

    it('draws the product path’s whole drawing scaled, in the box it was drawn in', () => {
      const { copy } = addSize(sampleAd(), width, height)
      const s = Math.min(width / 1080, height / 1080)
      expect(copy('product').props).toMatchObject({ shape: { kind: 'path', drawnIn: { width: 400, height: 400 } } })
      expect(copy('product').props.width).toBeCloseTo(400 * s, 2)
      expect(copy('product').props.height).toBeCloseTo(400 * s, 2)
    })
  })

  it('places the sample ad at 1080 × 1920 as the prototype did, each copy storing the guess it was placed by', () => {
    const { box, copy, design } = addSize(sampleAd(), 1080, 1920)
    expect(box('logo')).toEqual({ x: 60, y: 60, width: 200, height: 80 })
    expect(box('button')).toEqual({ x: 390, y: 1720, width: 300, height: 90 })
    expect(box('legal')).toEqual({ x: 90, y: 1840, width: 900, height: 40 })
    const guesses = Object.fromEntries(
      ['photo', 'logo', 'badge', 'headline', 'product', 'button', 'legal'].map((id) => [
        id,
        copy(id).props.constraints,
      ]),
    )
    expect(guesses).toEqual({
      photo: { horizontal: 'leftRight', vertical: 'topBottom' },
      logo: { horizontal: 'left', vertical: 'top' },
      badge: { horizontal: 'right', vertical: 'top' },
      headline: { horizontal: 'leftRight', vertical: 'top' },
      product: { horizontal: 'center', vertical: 'center' },
      button: { horizontal: 'center', vertical: 'bottom' },
      legal: { horizontal: 'leftRight', vertical: 'bottom' },
    })
    for (const id of Object.keys(guesses)) expect(design.nodes[id]?.props.constraints, id).toBeUndefined()
  })

  it('widens the headline guessed left and right across a wide size, from the scale to the new width', () => {
    // 628 / 1080 scales the headline to 52.33, 523.33 wide; the frame's 572 more across go to its width.
    const { box } = addSize(sampleAd(), 1200, 628)
    expect(box('headline')).toMatchObject({ x: 52.33, width: 1095.33 })
  })

  it('places a copy whose original has constraints by them, which it keeps', () => {
    const set = { props: { constraints: { horizontal: 'right', vertical: 'bottom' } } }
    const tall = addSize(sampleAd({ logo: set }), 1080, 1920)
    expect(tall.box('logo')).toEqual({ x: 60, y: 900, width: 200, height: 80 })
    expect(tall.copy('logo').props.constraints).toEqual({ horizontal: 'right', vertical: 'bottom' })
    const wide = addSize(sampleAd({ logo: set }), 1920, 1080)
    expect(wide.box('logo')).toEqual({ x: 900, y: 60, width: 200, height: 80 })
  })

  it('keeps a photo in Crop fit its shape, leaving bands where the frame grew', () => {
    const { box, copy } = addSize(sampleAd({ photo: { props: { fills: CROP_PHOTO } } }), 1080, 1920)
    expect(box('photo')).toEqual({ x: 0, y: 420, width: 1080, height: 1080 })
    expect(copy('photo').props.constraints).toEqual({ horizontal: 'center', vertical: 'center' })
  })

  it('places the layers in a group with it and those a flow places with their box, giving neither constraints', () => {
    const layout = { direction: 'row', gap: 0, padding: { top: 0, right: 0, bottom: 0, left: 0 } }
    const input = adOf(
      Object.fromEntries([
        layer('card', 'sq', 'group', [100, 100, 200, 880], {
          constraints: { horizontal: 'left', vertical: 'topBottom' },
        }),
        layer('inCard', 'card', 'graphic', [100, 100, 100, 440]),
        layer('row', 'sq', 'box', [300, 800, 600, 100], { layout }),
        layer('flowed', 'row', 'graphic', [300, 800, 100, 100]),
        layer('absolute', 'row', 'graphic', [320, 810, 50, 50], { absolute: true }),
      ]),
    )
    const { box, copy } = addSize(input, 1080, 1920)
    // The card is set to keep its top and bottom: 840 taller, it scales what it holds down by 1720 / 880.
    expect(box('card')).toEqual({ x: 100, y: 100, width: 200, height: 1720 })
    expect(box('inCard')).toEqual({ x: 100, y: 100, width: 100, height: 860 })
    expect(copy('inCard').props.constraints).toBeUndefined()
    // The row's middle is in the bottom third: it moves down 840, carrying what it holds.
    expect(copy('row').props.constraints).toEqual({ horizontal: 'center', vertical: 'bottom' })
    expect(box('flowed')).toEqual({ x: 300, y: 1640, width: 100, height: 100 })
    expect(copy('flowed').props.constraints).toBeUndefined()
    expect(box('absolute')).toEqual({ x: 320, y: 1650, width: 50, height: 50 })
    expect(copy('absolute').props.constraints).toEqual({ horizontal: 'left', vertical: 'center' })
  })

  it('stores a guess on a layer in a box the resize leaves where it was, from its place in that box', () => {
    const input = adOf(
      Object.fromEntries([
        layer('panel', 'sq', 'box', [0, 0, 1080, 200]),
        layer('mark', 'panel', 'graphic', [980, 60, 80, 80], { shape: { kind: 'ellipse' } }),
      ]),
    )
    // The panel is guessed left and right, and top: at 1080 × 1920 nothing about it changes.
    const { box, copy } = addSize(input, 1080, 1920)
    expect(box('panel')).toEqual({ x: 0, y: 0, width: 1080, height: 200 })
    expect(copy('mark').props.constraints).toEqual({ horizontal: 'right', vertical: 'center' })
  })

  it.each(SIZE_PRESETS.map((preset) => [preset.width, preset.height] as const))(
    'sets no text of the ad at %i × %i under the readable size there',
    (width, height) => {
      const { copy } = addSize(textAd(), width, height)
      const readable = readableTextSize(width, height)
      for (const id of ['headline', 'subline', 'legal', 'price'])
        expect(smallestDrawn(copy(id).props as TextProps), id).toBeGreaterThanOrEqual(readable)
    },
  )

  it('raises a text as a whole, its runs keeping their share of its size', () => {
    // 250 / 1080 would set the subline's first word at 7.87: it is raised to 11, the rest with it.
    const { copy } = addSize(textAd(), 300, 250)
    expect(copy('subline').props).toMatchObject({ style: { fontSize: 12.94 }, runs: [{ style: { fontSize: 11 } }] })
  })

  it('grows a raised text’s box as much as its letters, from the side it keeps to, so its lines break where they did', () => {
    const at = (x: number, constraints: object) =>
      addSize(
        adOf(
          Object.fromEntries([
            layer('sub', 'sq', 'text', [x, 400, 500, 100], { constraints, style: { ...STYLE, fontSize: 34 } }),
          ]),
        ),
        300,
        250,
      ).box('sub')
    // 250 / 1080 sets 34 at 7.87; 11 is 1.4 times that, so the 115.74 × 23.15 box the scale gives grows to 161.76 × 32.36.
    expect(at(90, { horizontal: 'left', vertical: 'top' })).toEqual({
      x: 20.83,
      y: 92.59,
      width: 161.76,
      height: 32.36,
    })
    expect(at(490, { horizontal: 'right', vertical: 'bottom' })).toEqual({
      x: 117.41,
      y: 83.38,
      width: 161.76,
      height: 32.36,
    })
    expect(at(290, { horizontal: 'center', vertical: 'center' })).toEqual({
      x: 69.12,
      y: 87.99,
      width: 161.76,
      height: 32.36,
    })
  })

  it('holds a raised text too wide for the frame inside it, with the room it had on its nearer side, growing with its words from there', () => {
    const input = adOf(
      Object.fromEntries([
        layer('legal', 'sq', 'text', [90, 1000, 900, 40], {
          text: 'Terms apply',
          boxMode: 'fixed',
          style: { ...STYLE, fontSize: 24 },
        }),
        layer('tag', 'sq', 'text', [90, 60, 900, 40], { boxMode: 'autoWidth', style: { ...STYLE, fontSize: 24 } }),
        layer('note', 'sq', 'text', [90, 500, 300, 40], { boxMode: 'fixed', style: { ...STYLE, fontSize: 24 } }),
      ]),
    )
    const { box, copy } = addSize(input, 300, 250)
    // Wanting 412.5 wide, it gets the 258.34 that leaves 20.83 each side: two lines, each 9.26 × 1.98 tall, kept to the bottom.
    expect(box('legal')).toEqual({ x: 20.82, y: 204.07, width: 258.34, height: 36.67 })
    // Its lines break elsewhere, so it grows with its words at that width, as does a text that grew across with them.
    expect(copy('legal').props).toMatchObject({ boxMode: 'autoHeight' })
    expect(copy('tag').props).toMatchObject({ boxMode: 'autoHeight' })
    // A text whose box grows as much as its letters, its lines breaking where they did, keeps its box mode.
    expect(copy('note').props).toMatchObject({ boxMode: 'fixed', width: 137.49 })
  })

  it('puts a raised text kept to the bottom that comes out taller than the frame at its top, where its first lines show', () => {
    const input = adOf(
      Object.fromEntries([
        layer('legal', 'sq', 'text', [90, 900, 900, 100], {
          text: 'Terms apply',
          constraints: { horizontal: 'left', vertical: 'bottom' },
          style: { ...STYLE, fontSize: 24 },
        }),
      ]),
    )
    expect(addSize(input, 320, 50).box('legal')).toMatchObject({ y: 0, height: 91.67 })
  })

  it('names the new frame by its size', () => {
    const { design, frameId } = addSize(sampleAd(), 1200, 628)
    expect(design.frames[frameId]?.name).toBe('1200×628')
    expect(design.frames.sq?.name).toBe('Square')
  })

  it('writes nothing of the original frame and its layers, and undo removes the new frame whole, in one step', () => {
    const { store, tab, before, design, frameId } = addSize(sampleAd(), 728, 90)
    expect(design.frames.sq).toEqual(before.frames.sq)
    for (const id of Object.keys(before.nodes)) expect(design.nodes[id], id).toEqual(before.nodes[id])
    tab.undo()
    expect(readDesign(store)).toEqual(before)
    expect(readDesign(store).frames[frameId]).toBeUndefined()
    expect(tab.canUndo()).toBe(false)
  })
})
