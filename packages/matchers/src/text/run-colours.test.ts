import { describe, expect, it } from 'vitest'

import type { Pixels } from '@dazbee/renderer'
import { loadCanvasKit } from '@dazbee/renderer/node'
import type { Color, Rgb } from '@dazbee/schema'

import { ciede2000, srgbToLab } from '../looks-same/colour.ts'
import { hexColour, hexRgb } from '../shape/parts/colour.ts'
import { type Placed, textDrawer, type TextLayerProps, textLayerProps, type TextLook } from './draw-text.ts'
import { judgeText } from './light/verify.ts'
import { readPiece } from './read-piece.ts'
import { colourRuns, type LetterColour, letterColours, runsOf } from './run-colours.ts'
import { NO_KIT, shippedFaces } from './test-text-pieces.ts'

const ck = await loadCanvasKit()

/** The shipped face the pieces are drawn in. */
const FACE = { family: 'Noto Sans', weight: 800, style: 'normal' as const }
const bytes = shippedFaces().get(`${FACE.family}|${FACE.weight}|${FACE.style}`)
if (!bytes) throw new Error('Noto Sans 800 is not shipped')
const FACES = [{ family: FACE.family, bytes }]

/** A headline whose last dot is drawn in another colour, and the dot's place in it. */
const WORDS = 'Ride the\ncity lighter.'
const DOT = { start: WORDS.length - 1, end: WORDS.length }
/** The second line's first word. */
const CITY = { start: 9, end: 13 }
const WHITE: Color = '#FEFEFEFF'
const NAVY: Color = '#0F2748FF'
const LIME: Color = '#9EDA20FF'
/** The colour the pieces are seen on. */
const BEHIND: Rgb = [40, 90, 70]

const LOOK: TextLook = { ...FACE, size: 64, spacing: 0, align: 'start', color: WHITE }
const PLACE: Placed = { x: 12, y: 8, width: 420, height: 180, rotation: 0 }
const FRAME = { width: 444, height: 196 }

/** Colours within this ΔE00 are the colour drawn. */
const COLOUR_WITHIN = 1

/** The headline drawn as a cut-out in a look, with runs, over the layers given to lie under it. */
function drawn(look: TextLook, runs: TextLayerProps['runs'] = [], ...under: TextLayerProps[]): Pixels {
  const drawer = textDrawer(ck, FACES)
  try {
    return drawer.draw(FRAME.width, FRAME.height, ...under, { ...textLayerProps(WORDS, look, PLACE), runs })
  } finally {
    drawer.delete()
  }
}

/** A cut-out put over a flat colour. */
function flat({ width, height, pixels }: Pixels, [red, green, blue]: Rgb): Pixels {
  const out = new Uint8Array(pixels.length)
  for (let i = 0; i < width * height; i++) {
    const alpha = (pixels[i * 4 + 3] ?? 0) / 255
    for (const [c, behind] of [red, green, blue].entries())
      out[i * 4 + c] = Math.round((pixels[i * 4 + c] ?? 0) * alpha + behind * (1 - alpha))
    out[i * 4 + 3] = 255
  }
  return { width, height, pixels: out }
}

/** A picture with each colour channel of each pixel moved by up to `by`, the same every time. */
function grainy({ width, height, pixels }: Pixels, by: number): Pixels {
  const out = new Uint8Array(pixels)
  // A linear congruential generator, so the grain is the same in every runtime.
  let seed = 11
  for (let i = 0; i < width * height; i++)
    for (let c = 0; c < 3; c++) {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0
      const moved = (pixels[i * 4 + c] ?? 0) + Math.round(((seed >>> 16) / 65535 - 0.5) * 2 * by)
      out[i * 4 + c] = Math.max(0, Math.min(255, moved))
    }
  return { width, height, pixels: out }
}

/** The colour runs the matcher gives the headline over a piece, set in `look` at `place` and judged there. */
function runsOver(piece: Pixels, look: TextLook = LOOK, place: Placed = PLACE) {
  const reading = readPiece({ pixels: piece, words: WORDS, angle: 0 }).whole
  const target = { reading, words: WORDS, backgrounds: [BEHIND], kit: NO_KIT, scale: 1 }
  const drawer = textDrawer(ck, FACES)
  const { scores } = judgeText(drawer, target, look, place)
  drawer.delete()
  return colourRuns(ck, FACES, target, { look, place, scores })
}

/** How far two colours are apart, in ΔE00. */
function apart(a: Color, b: Color): number {
  return ciede2000(srgbToLab(...hexRgb(a)), srgbToLab(...hexRgb(b)))
}

/** Letters one unit wide from 0 on, each read from 40 pixels in the colour given; null for a letter not read. */
function lettersIn(colours: readonly (Rgb | null)[]): LetterColour[] {
  return colours.map((colour, k) => ({ start: k, end: k + 1, count: colour ? 40 : 3, colour }))
}

describe('runsOf', () => {
  const white: Rgb = [254, 254, 254]
  const lime: Rgb = [158, 218, 32]

  it('gives no run to letters of one colour, grain and all', () => {
    const letters = lettersIn([white, [250, 252, 249], [255, 251, 254], [248, 250, 252], white])
    expect(runsOf('abcde', WHITE, letters)).toEqual([])
  })

  it('gives a last letter in another colour as a run in its colour', () => {
    expect(runsOf('abcd.', WHITE, lettersIn([white, white, white, white, lime]))).toEqual([
      { start: 4, end: 5, style: { color: LIME } },
    ])
  })

  it('gives words in another colour as one run with the white space between them', () => {
    const text = 'ab cd ef'
    const letters = [0, 1, 3, 4, 6, 7].map((start, k) => ({
      start,
      end: start + 1,
      count: 40,
      colour: k < 2 ? white : lime,
    }))
    expect(runsOf(text, WHITE, letters)).toEqual([{ start: 3, end: 8, style: { color: LIME } }])
  })

  it("gives a letter too thin to read its word's colour: the letter before it, else the one after", () => {
    const text = 'ab il'
    const letters = [
      { start: 0, end: 1, count: 40, colour: white },
      { start: 1, end: 2, count: 3, colour: null },
      { start: 3, end: 4, count: 3, colour: null },
      { start: 4, end: 5, count: 40, colour: lime },
    ]
    expect(runsOf(text, WHITE, letters)).toEqual([{ start: 3, end: 5, style: { color: LIME } }])
  })

  it('gives no run to letters whose colours step from one to another, as a gradient fills them', () => {
    const steps = Array.from({ length: 9 }, (_, k): Rgb => [254 - 12 * k, 254 - 4 * k, 254 - 27 * k])
    expect(runsOf('abcdefghi', WHITE, lettersIn(steps))).toEqual([])
  })

  it("gives no run when a colour's letters are spread a third as far as the colours are apart", () => {
    const near: Rgb = [218, 218, 218]
    const other: Rgb = [172, 172, 172]
    const spread = ciede2000(srgbToLab(...white), srgbToLab(...near))
    const between = ciede2000(srgbToLab(...white), srgbToLab(...other))
    expect(between).toBeGreaterThan(16)
    expect(between).toBeLessThan(3 * spread)
    expect(runsOf('abcd', WHITE, lettersIn([white, white, near, other]))).toEqual([])
    expect(runsOf('abcd', WHITE, lettersIn([white, white, white, other]))).toHaveLength(1)
  })

  it("gives no run when no colour of the letters is near the layer's", () => {
    expect(runsOf('abcd.', NAVY, lettersIn([white, white, white, white, lime]))).toEqual([])
  })
})

describe('letterColours', () => {
  it('reads each letter of a cut-out in the colour it is inked in', () => {
    const piece = drawn(LOOK, [{ ...DOT, style: { color: LIME } }])
    const drawer = textDrawer(ck, FACES)
    const letters = letterColours(drawer, piece, textLayerProps(WORDS, LOOK, PLACE))
    drawer.delete()
    expect(letters.map(({ start, end }) => WORDS.slice(start, end)).join('')).toBe(WORDS.replace(/\s/g, ''))
    for (const { start, colour } of letters) {
      expect(colour).not.toBeNull()
      expect(apart(hexColour(...(colour ?? BEHIND)), start === DOT.start ? LIME : WHITE)).toBeLessThan(COLOUR_WITHIN)
    }
  })

  it('reads a flat crop 1 px inside its letters, where the colour behind does not mix in', () => {
    const piece = flat(drawn({ ...LOOK, color: NAVY }, [{ ...DOT, style: { color: LIME } }]), [255, 255, 255])
    const ink = readPiece({ pixels: piece, words: WORDS, angle: 0 }).whole.ink.data
    const drawer = textDrawer(ck, FACES)
    const letters = letterColours(drawer, piece, textLayerProps(WORDS, { ...LOOK, color: NAVY }, PLACE), ink)
    drawer.delete()
    for (const { start, colour } of letters) {
      expect(colour).not.toBeNull()
      expect(apart(hexColour(...(colour ?? BEHIND)), start === DOT.start ? LIME : NAVY)).toBeLessThan(COLOUR_WITHIN)
    }
  })
})

describe('colourRuns', () => {
  it("gives a headline's last dot in another colour as a run, and the text judged with it", () => {
    const found = runsOver(drawn(LOOK, [{ ...DOT, style: { color: LIME } }]))
    expect(found?.runs).toEqual([{ ...DOT, style: { color: LIME } }])
    expect(found?.judged.same).toBe(true)
    expect(found?.judged.scores.far).toBe(0)
  })

  it('gives a word in another colour as a run, through grain', () => {
    const found = runsOver(grainy(drawn(LOOK, [{ ...CITY, style: { color: LIME } }]), 14))
    expect(found?.runs).toHaveLength(1)
    expect(found?.runs[0]).toMatchObject(CITY)
    expect(apart(found?.runs[0]?.style.color ?? WHITE, LIME)).toBeLessThan(4)
  })

  it('gives a dot in another colour on a flat crop as a run', () => {
    const look = { ...LOOK, color: NAVY }
    const found = runsOver(flat(drawn(look, [{ ...DOT, style: { color: LIME } }]), [255, 255, 255]), look)
    expect(found?.runs).toEqual([{ ...DOT, style: { color: LIME } }])
  })

  it.each([
    ['as drawn', 0],
    ['grainy', 14],
    ['very grainy', 40],
  ])('gives a text of one colour no run, %s', (_, grain) => {
    expect(runsOver(grainy(drawn(LOOK), grain))).toBeNull()
    expect(
      runsOver(flat(grainy(drawn({ ...LOOK, color: NAVY }), grain), [255, 255, 255]), { ...LOOK, color: NAVY }),
    ).toBeNull()
  })

  it('gives a text with a shadow under its letters no run', () => {
    const shadow = textLayerProps(WORDS, { ...LOOK, color: '#101010C0' }, { ...PLACE, x: PLACE.x + 4, y: PLACE.y + 4 })
    expect(runsOver(drawn(LOOK, [], shadow))).toBeNull()
  })

  it('gives a text whose letters step from one colour to another no run', () => {
    const letters = [...WORDS].flatMap((letter, at) => (letter.trim() ? [at] : []))
    const [from, to] = [hexRgb(WHITE), hexRgb(LIME)]
    const steps = letters.map((at, k) => {
      const mixed = ([0, 1, 2] as const).map((c) => from[c] + ((to[c] - from[c]) * k) / (letters.length - 1))
      return { start: at, end: at + 1, style: { color: hexColour(mixed[0] ?? 0, mixed[1] ?? 0, mixed[2] ?? 0) } }
    })
    expect(runsOver(drawn(LOOK, steps))).toBeNull()
  })

  it('gives a text with an outline no run', () => {
    const look = { ...LOOK, outline: { width: 3, color: '#111111FF' as Color } }
    expect(runsOver(drawn(look, [{ ...DOT, style: { color: LIME } }]), look)).toBeNull()
  })

  it('gives a text set where its letters are not no run', () => {
    const piece = drawn(LOOK, [{ ...CITY, style: { color: LIME } }])
    expect(runsOver(piece, LOOK, { ...PLACE, x: PLACE.x + 60 })).toBeNull()
  })
})
