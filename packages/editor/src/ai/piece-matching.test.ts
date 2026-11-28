import { describe, expect, it } from 'vitest'

import {
  type LayerPlanAnswer,
  type MadePiece,
  type MatchAnswer,
  type ReadingAnswer,
  UnplacedLayer,
} from '@dazbee/schema'

import {
  coverWith,
  hiddenUnder,
  matchedAs,
  matchedLayers,
  noCover,
  pieceMatchJob,
  rebuiltLayers,
  seenBehind,
} from './piece-matching.ts'

/** A split piece of part `part`, at `x`, `y`, `width` × `height` px of the picture. */
const piece = (part: string | null, kind: MadePiece['kind'], x = 0, y = 0, width = 100, height = 40): MadePiece => ({
  picture: { key: 'k', width, height, assetId: `cut-${part ?? 'loose'}` },
  x,
  y,
  part,
  kind,
  layer: 1,
  turned: null,
})

/** A text part of a plan saying `content`, in `lines` when the plan found them, in a box on the plan's grid. */
const part = (
  id: string,
  content: string,
  lines: string[] = [],
  box = { x_min: 0, y_min: 0, x_max: 999, y_max: 999 },
) => ({
  id,
  kind: 'text' as const,
  name: 'Headline',
  content,
  text_lines: lines,
  box,
  shadow: 'none' as const,
  group: null,
  ming_layer: 1,
})

const planOf = (...elements: LayerPlanAnswer['elements']): LayerPlanAnswer => ({
  ad_type: 'graphical',
  elements,
  prompt: '',
  notes: [],
  design_name: 'Sale',
})

/** A reading of block `id` as `text`, set in a font or in custom lettering. */
const readingOf = (id: string, text: string, lettering: 'font' | 'custom' = 'font'): ReadingAnswer => ({
  blocks: [
    {
      id,
      text,
      corrections: [],
      lettering,
      style: 'sans-serif',
      italic: false,
      rounded: false,
      mixed_styles: false,
      mixed_note: '',
    },
  ],
})

/** A text layer as the text matcher answers it, in its piece's pixels. */
const text = (props: Record<string, unknown> = {}) =>
  UnplacedLayer.parse({
    type: 'text',
    name: 'Big sale',
    props: {
      x: 4,
      y: 6,
      width: 80,
      height: 30,
      text: 'Big sale',
      boxMode: 'autoWidth',
      style: { fontFamily: 'Inter', fontWeight: 700, fontSize: 24, color: '#111111FF' },
      ...props,
    },
  })

/** A rectangle as the shape matcher answers it, in its piece's pixels. */
const rect = (x: number, y: number, width: number, height: number) =>
  UnplacedLayer.parse({
    type: 'graphic',
    name: 'Rectangle',
    props: {
      x,
      y,
      width,
      height,
      shape: { kind: 'rect', cornerRadius: 8 },
      fills: [{ type: 'solid', color: '#FF0000FF' }],
    },
  })

const SCORES = { ssim: 0.9, inkMissed: 0, far: 0 }
const answerOf = (layers: UnplacedLayer[], approximate = false): MatchAnswer => ({
  kind: 'layers',
  layers,
  scores: SCORES,
  approximate,
})

const KIT = { colors: {}, fonts: {}, textStyles: [] }

/** A picture `width` × `height` px whose pixel at `x`, `y` is as opaque as `alpha(x, y)` says, 0 to 255. */
const drawnAs = (width: number, height: number, alpha: (x: number, y: number) => number) => ({
  width,
  height,
  pixels: Uint8Array.from(
    Array.from({ length: width * height }, (_, i) => [9, 9, 9, alpha(i % width, Math.floor(i / width))]).flat(),
  ),
})

describe('matchedAs', () => {
  const plan = planOf(part('e1', 'Big sale', ['Big', 'sale']), part('e2', 'Shop now'), part('e3', '  '))

  it('matches a text piece as the words the reading read, else the plan’s lines, else its content', () => {
    expect(matchedAs(plan, readingOf('e1', ' Big\nsale! '), piece('e1', 'text'))).toEqual({
      kind: 'text',
      words: 'Big\nsale!',
    })
    expect(matchedAs(plan, readingOf('e1', '  '), piece('e1', 'text'))).toEqual({ kind: 'text', words: 'Big\nsale' })
    expect(matchedAs(plan, null, piece('e2', 'text'))).toEqual({ kind: 'text', words: 'Shop now' })
  })

  it('gives a text piece its turned box’s angle', () => {
    const turned = { ...piece('e2', 'text'), turned: { cx: 50, cy: 20, width: 100, height: 30, angle: -11 } }
    expect(matchedAs(plan, null, turned)).toEqual({ kind: 'text', words: 'Shop now', angle: -11 })
  })

  it('matches a shape piece as shapes, of a part or of none', () => {
    expect(matchedAs(plan, null, piece('gone', 'shape'))).toEqual({ kind: 'shape' })
    expect(matchedAs(null, null, piece(null, 'shape'))).toEqual({ kind: 'shape' })
  })

  it('matches a graphic piece and a background piece as shapes too, of a part or of none', () => {
    for (const kind of ['graphic', 'background'] as const) {
      expect(matchedAs(plan, null, piece('e1', kind))).toEqual({ kind: 'shape' })
      expect(matchedAs(null, null, piece(null, kind))).toEqual({ kind: 'shape' })
      expect(matchedAs(plan, null, piece('e1', kind, 0, 0, 2049, 10))).toBeNull()
    }
  })

  it('keeps a picture every other kind, a text with no part or no words, custom lettering and a piece too big to match', () => {
    for (const kind of ['logo', 'cutout', 'photo', 'other'] as const)
      expect(matchedAs(plan, null, piece('e1', kind))).toBeNull()
    expect(matchedAs(plan, null, piece('gone', 'text'))).toBeNull()
    expect(matchedAs(null, null, piece('e1', 'text'))).toBeNull()
    expect(matchedAs(plan, null, piece('e3', 'text'))).toBeNull()
    expect(matchedAs(plan, readingOf('e1', 'Big sale', 'custom'), piece('e1', 'text'))).toBeNull()
    expect(matchedAs(plan, null, piece('e1', 'shape', 0, 0, 2049, 10))).toBeNull()
    expect(matchedAs(plan, null, piece('e1', 'shape', 0, 0, 2048, 10))).toEqual({ kind: 'shape' })
  })
})

describe('pieceMatchJob', () => {
  it('asks for the piece’s own picture whole, as one piece, with the colours it is seen on when any are given', () => {
    const size = { width: 100, height: 40 }
    expect(pieceMatchJob('AAAA', size, { kind: 'text', words: 'Big sale', angle: 3 }, KIT, [[1, 2, 3]])).toEqual({
      picture: 'AAAA',
      pieces: [{ kind: 'text', words: 'Big sale', angle: 3, rect: { x: 0, y: 0, width: 100, height: 40 } }],
      kit: KIT,
      setting: 'hybrid',
      backgrounds: [[1, 2, 3]],
    })
    expect(pieceMatchJob('AAAA', size, { kind: 'text', words: 'Big sale' }, KIT)).not.toHaveProperty('backgrounds')
    expect(pieceMatchJob('AAAA', size, { kind: 'shape' }, KIT, [[1, 2, 3]])).toEqual({
      picture: 'AAAA',
      pieces: [{ kind: 'shape', rect: { x: 0, y: 0, width: 100, height: 40 } }],
      kit: KIT,
      setting: 'hybrid',
      backgrounds: [[1, 2, 3]],
    })
    expect(pieceMatchJob('AAAA', size, { kind: 'shape' }, KIT)).not.toHaveProperty('backgrounds')
    expect(pieceMatchJob('AAAA', size, { kind: 'shape' }, KIT, [])).not.toHaveProperty('backgrounds')
  })

  it('carries what is hidden of a shape, and of no text', () => {
    const size = { width: 100, height: 40 }
    expect(pieceMatchJob('AAAA', size, { kind: 'shape' }, KIT, undefined, 'gA==')).toEqual({
      picture: 'AAAA',
      pieces: [{ kind: 'shape', rect: { x: 0, y: 0, width: 100, height: 40 } }],
      kit: KIT,
      setting: 'hybrid',
      hidden: 'gA==',
    })
    expect(pieceMatchJob('AAAA', size, { kind: 'shape' }, KIT)).not.toHaveProperty('hidden')
    expect(pieceMatchJob('AAAA', size, { kind: 'text', words: 'Big sale' }, KIT, undefined, 'gA==')).not.toHaveProperty(
      'hidden',
    )
  })
})

describe('seenBehind', () => {
  /** A picture of `count` pixels in a row, each of `colour(i)`. */
  const row = (count: number, colour: (i: number) => [number, number, number, number]) => ({
    width: count,
    height: 1,
    pixels: Uint8Array.from(Array.from({ length: count }, (_, i) => colour(i)).flat()),
  })

  it('is the median colour of the picture where the piece is clear', () => {
    // The piece covers the first 20 pixels; behind the rest the picture is mostly one blue, with a few stray reds.
    const piecePixels = row(60, (i) => [0, 0, 0, i < 20 ? 255 : i < 22 ? 7 : 0])
    const under = row(60, (i) => (i < 20 ? [9, 9, 9, 255] : i % 10 === 0 ? [250, 0, 0, 255] : [10, 20, 200, 255]))
    expect(seenBehind(under, piecePixels)).toEqual([10, 20, 200])
  })

  it('is, a channel, the value in the middle of the clear pixels’ values in order: of an even count, the upper of the two', () => {
    const clear = (count: number) => row(count, () => [0, 0, 0, 0])
    // 16 clear pixels: 8 reds of 10 then 8 of 20, greens of 30 and 40 in turn.
    const even = row(16, (i) => [i < 8 ? 10 : 20, i % 2 === 0 ? 30 : 40, 5, 255])
    expect(seenBehind(even, clear(16))).toEqual([20, 40, 5])
    // 17 clear pixels: 9 reds of 10 and 8 of 20, 8 greens of 30 and 9 of 40.
    const odd = row(17, (i) => [i < 9 ? 10 : 20, i < 8 ? 30 : 40, 5, 255])
    expect(seenBehind(odd, clear(17))).toEqual([10, 40, 5])
  })

  it('is what sorting each channel’s values where the piece is clear gives, for even and odd counts of them', () => {
    // Each channel's values are spread their own way, in no order, with 0 and 255 among them.
    const under = row(90, (i) => [(i * 37) % 256, 255 - ((i * 13) % 97), i % 3 === 0 ? 0 : 255, 255])
    for (const count of [16, 17, 50, 51, 90]) {
      // Every other pixel is clear at first, then all of them, until `count` are.
      const order = Array.from({ length: 90 }, (_, i) => (i < 45 ? i * 2 : (i - 45) * 2 + 1))
      const shown = new Set(order.slice(0, count))
      const piecePixels = row(90, (i) => [0, 0, 0, shown.has(i) ? 0 : 255])
      const sorted = [0, 1, 2].map((channel) => {
        const values = [...shown].map((i) => under.pixels[i * 4 + channel] ?? 0)
        return values.sort((a, b) => a - b)[values.length >> 1]
      })
      expect(seenBehind(under, piecePixels)).toEqual(sorted)
    }
  })

  it('is none when the piece leaves too little clear, or the two differ in size', () => {
    const solid = row(60, (i) => [0, 0, 0, i < 50 ? 255 : 0])
    expect(
      seenBehind(
        row(60, () => [1, 2, 3, 255]),
        solid,
      ),
    ).toBeNull()
    // 15 clear pixels are too few, 16 enough.
    const under = row(60, () => [1, 2, 3, 255])
    expect(
      seenBehind(
        under,
        row(60, (i) => [0, 0, 0, i < 45 ? 255 : 0]),
      ),
    ).toBeNull()
    expect(
      seenBehind(
        under,
        row(60, (i) => [0, 0, 0, i < 44 ? 255 : 0]),
      ),
    ).toEqual([1, 2, 3])
    expect(
      seenBehind(
        row(59, () => [1, 2, 3, 255]),
        row(60, () => [0, 0, 0, 0]),
      ),
    ).toBeNull()
  })
})

describe('noCover', () => {
  it('covers nothing of the picture', () => {
    expect(noCover({ width: 3, height: 2 })).toEqual({ width: 3, height: 2, covered: new Uint8Array(6) })
  })
})

describe('coverWith', () => {
  it('covers the picture where the piece is at least half opaque, at the piece’s place', () => {
    const cover = noCover({ width: 4, height: 3 })
    // A 2 × 2 piece at 1, 1: opaque, just half opaque, just under half, and clear.
    coverWith(
      cover,
      { x: 1, y: 1 },
      drawnAs(2, 2, (x, y) => [255, 128, 127, 0][y * 2 + x] ?? 0),
    )
    expect([...cover.covered]).toEqual([0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0])
  })

  it('keeps what earlier pieces cover, and covers nothing past the picture', () => {
    const cover = noCover({ width: 3, height: 2 })
    coverWith(
      cover,
      { x: 0, y: 0 },
      drawnAs(1, 1, () => 255),
    )
    // A 2 × 2 piece at 2, 1 reaches a pixel past the picture's right side and one past its bottom.
    coverWith(
      cover,
      { x: 2, y: 1 },
      drawnAs(2, 2, () => 255),
    )
    expect([...cover.covered]).toEqual([1, 0, 0, 0, 0, 1])
  })
})

describe('hiddenUnder', () => {
  /** A 4 × 4 picture whose left half a piece in front covers. */
  const leftHalf = () => {
    const cover = noCover({ width: 4, height: 4 })
    coverWith(
      cover,
      { x: 0, y: 0 },
      drawnAs(2, 4, () => 255),
    )
    return cover
  }

  it('is what the pieces in front cover of the piece, a byte a pixel of the piece’s own picture', () => {
    // A 3 × 2 piece at 1, 1: its first column lies under the cover.
    const hidden = hiddenUnder(leftHalf(), { x: 1, y: 1, picture: { key: 'k', width: 3, height: 2 } })
    expect([...(hidden ?? [])]).toEqual([1, 0, 0, 1, 0, 0])
  })

  it('is every pixel of a piece wholly covered, and none when nothing covers the piece', () => {
    const cover = leftHalf()
    expect([...(hiddenUnder(cover, { x: 0, y: 2, picture: { key: 'k', width: 2, height: 2 } }) ?? [])]).toEqual([
      1, 1, 1, 1,
    ])
    expect(hiddenUnder(cover, { x: 2, y: 0, picture: { key: 'k', width: 2, height: 4 } })).toBeNull()
    expect(
      hiddenUnder(noCover({ width: 4, height: 4 }), { x: 0, y: 0, picture: { key: 'k', width: 4, height: 4 } }),
    ).toBeNull()
  })
})

describe('matchedLayers', () => {
  it('places a layer where the picture’s fill draws its piece, its box and every size scaled with the picture', () => {
    // A 512 px picture fills a 1024 px frame at twice its size.
    const [placed] =
      matchedLayers([text()], { x: 100, y: 50 }, { width: 512, height: 512 }, { width: 1024, height: 1024 }) ?? []
    expect(placed?.props).toMatchObject({ x: 208, y: 112, width: 160, height: 60, style: { fontSize: 48 } })
    expect(placed).toMatchObject({ type: 'text', name: 'Big sale' })
  })

  it('carries a piece over by the part of the picture a frame of another ratio shows', () => {
    // A 1000 × 500 picture covers a 500 px square at 1 to 1, 250 px of it off each side.
    const [placed] =
      matchedLayers(
        [rect(10, 20, 30, 40)],
        { x: 300, y: 0 },
        { width: 1000, height: 500 },
        { width: 500, height: 500 },
      ) ?? []
    expect(placed?.props).toMatchObject({
      x: 60,
      y: 20,
      width: 30,
      height: 40,
      shape: { kind: 'rect', cornerRadius: 8 },
    })
  })

  it('scales a graphic’s corners, and keeps a layer’s turn', () => {
    const turned = text({ rotation: -11 })
    const placed = matchedLayers(
      [rect(0, 0, 10, 10), turned],
      { x: 0, y: 0 },
      { width: 100, height: 100 },
      { width: 50, height: 50 },
    )
    expect(placed?.[0]?.props).toMatchObject({ width: 5, height: 5, shape: { cornerRadius: 4 } })
    expect(placed?.[1]?.props).toMatchObject({ rotation: -11, style: { fontSize: 12 } })
  })

  it('places nothing of an answer that holds a layer of another type', () => {
    const group = UnplacedLayer.parse({ type: 'group', name: 'Group', props: { x: 0, y: 0, width: 1, height: 1 } })
    expect(
      matchedLayers([rect(0, 0, 1, 1), group], { x: 0, y: 0 }, { width: 10, height: 10 }, { width: 10, height: 10 }),
    ).toBeNull()
  })
})

describe('rebuiltLayers', () => {
  const size = { width: 1000, height: 1000 }
  // The headline's box on the plan's grid is 300 × 100 px of the picture.
  const plan = planOf(part('e1', 'Big sale', [], { x_min: 100, y_min: 100, x_max: 399, y_max: 199 }))
  const inside = piece('e1', 'text', 100, 100, 300, 100)
  // Reaching 60 px past the box's right side: over half of the box's shorter side.
  const past = piece('e1', 'text', 100, 100, 360, 100)

  it('places a matcher’s layers, and keeps a picture a piece the matcher kept one or that has no answer', () => {
    expect(rebuiltLayers(answerOf([text()]), inside, plan, size, size)).toHaveLength(1)
    expect(rebuiltLayers({ kind: 'picture', why: 'photo' }, inside, plan, size, size)).toBeNull()
    expect(rebuiltLayers(undefined, inside, plan, size, size)).toBeNull()
  })

  it('places an approximate text whose piece is its planned part, even a little past its box', () => {
    expect(rebuiltLayers(answerOf([text()], true), inside, plan, size, size)).toHaveLength(1)
    expect(
      rebuiltLayers(answerOf([text()], true), piece('e1', 'text', 60, 100, 340, 100), plan, size, size),
    ).toHaveLength(1)
    expect(rebuiltLayers(answerOf([text()], true), piece(null, 'text'), plan, size, size)).toHaveLength(1)
  })

  it('keeps a picture an approximate text whose piece holds more than its planned part, and places it when it looks the same', () => {
    expect(rebuiltLayers(answerOf([text()], true), past, plan, size, size)).toBeNull()
    expect(rebuiltLayers(answerOf([text()]), past, plan, size, size)).toHaveLength(1)
  })
})
