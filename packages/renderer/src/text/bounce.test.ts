import { describe, expect, it } from 'vitest'

import { FALLBACK_FAMILIES } from '@dazbee/fonts'
import { loadFontFiles } from '@dazbee/fonts/node'
import { type TextBounce, TextProps } from '@dazbee/schema'

import { loadCanvasKit } from '../node.ts'
import { resourceCache } from '../resources.ts'
import { bounceMove, movesLetters } from './bounce.ts'
import { layoutText } from './layout.ts'
import { inPlace, placedBounds, placedPoint, placeLetters } from './placed.ts'

const ck = await loadCanvasKit()
const resources = resourceCache(ck).resources({
  fonts: loadFontFiles(),
  fallbackFamilies: [...FALLBACK_FAMILIES],
  images: {},
})

/** A glyph where it is drawn, and where the straight layout draws it. */
interface Moved {
  offset: number
  advance: number
  /** Its RSXform, and the straight one. */
  xform: number[]
  straight: number[]
}

/** A text in Noto Sans at 40 px in a fixed box, with `more` over it. */
function textOf(text: string, more: Record<string, unknown> = {}) {
  return TextProps.parse({
    x: 0,
    y: 0,
    width: 1000,
    height: 200,
    boxMode: 'fixed',
    text,
    style: { fontFamily: 'Noto Sans', fontSize: 40, color: '#000000FF' },
    ...more,
  })
}

/** Each glyph of `props` placed, beside the same glyph laid out straight. */
function moved(props: TextProps): Moved[] {
  const laid = layoutText(ck, props, resources)
  const plain = { ...props, style: { ...props.style }, runs: props.runs.map((r) => ({ ...r, style: { ...r.style } })) }
  delete plain.bounce
  delete plain.style.turn
  for (const run of plain.runs) delete run.style.turn
  const straightLaid = layoutText(ck, plain, resources)
  const straight = placeLetters(ck, straightLaid, inPlace)
  if (!laid.placed) throw new Error('not placed')
  const glyphs = laid.placed.runs.flatMap((run) =>
    [...run.offsets].map((offset, i) => ({
      offset,
      advance: run.advances[i] ?? 0,
      xform: [...run.xforms.subarray(4 * i, 4 * i + 4)],
    })),
  )
  const flat = straight.runs.flatMap((run) =>
    [...run.offsets].map((_, i) => [...run.xforms.subarray(4 * i, 4 * i + 4)]),
  )
  straight.delete()
  straightLaid.delete()
  laid.delete()
  return glyphs.map((g, i) => ({ ...g, straight: flat[i] ?? [] }))
}

/** The first output of mulberry32 seeded with `n`, mapped to −1 to 1. */
function u(n: number): number {
  let a = n >>> 0
  a = (a + 0x6d2b79f5) | 0
  let t = Math.imul(a ^ (a >>> 15), 1 | a)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 2 ** 31 - 1
}

/** Where a glyph turned `turn` degrees about the middle of its advance on its baseline, then raised `raise`, is drawn. */
function expected(straight: number[], advance: number, raise: number, turn: number): number[] {
  const [, , x = 0, y = 0] = straight
  const angle = (turn * Math.PI) / 180
  const [cos, sin] = [Math.cos(angle), Math.sin(angle)]
  const [px, py] = [x + advance / 2, y]
  // The glyph's origin, half its advance before the pivot, turned about it.
  return [cos, sin, px - (cos * advance) / 2, py - (sin * advance) / 2 - raise]
}

function expectXform(actual: number[], wanted: number[]) {
  for (const [k, value] of wanted.entries()) expect(actual[k]).toBeCloseTo(value, 3)
}

describe('movesLetters', () => {
  it('moves letters with a bounce or a letter turn other than 0, on the text or a run', () => {
    expect(movesLetters(textOf('Hi'))).toBe(false)
    expect(
      movesLetters(textOf('Hi', { style: { fontFamily: 'Noto Sans', fontSize: 40, color: '#000000FF', turn: 0 } })),
    ).toBe(false)
    expect(movesLetters(textOf('Hi', { bounce: { style: 'wavy', amount: 0, seed: 1 } }))).toBe(true)
    expect(movesLetters(textOf('Hi', { runs: [{ start: 1, end: 2, style: { turn: 5 } }] }))).toBe(true)
  })
})

describe('bounceMove', () => {
  it('raises wavy letters by sin(i·π/3) of half the font size at full amount, unturned', () => {
    const wavy: TextBounce = { style: 'wavy', amount: 50, seed: 1 }
    for (let i = 0; i < 12; i++) {
      expect(bounceMove(wavy, i, 40).raise).toBeCloseTo(Math.sin((i * Math.PI) / 3) * 0.5 * 20, 9)
      expect(bounceMove(wavy, i, 40).turn).toBe(0)
    }
  })

  it('raises and turns random letters by mulberry32 of the seed and the letter’s count', () => {
    for (const seed of [0, 1, 7, 4_000_000_000, 2 ** 40 + 3]) {
      const random: TextBounce = { style: 'random', amount: 80, seed }
      for (let i = 0; i < 8; i++) {
        const n = (seed % 2 ** 32) * 65537 + 2 * i
        const move = bounceMove(random, i, 30)
        expect(move.raise).toBeCloseTo(u(n % 2 ** 32) * 0.8 * 15, 9)
        expect(move.turn).toBeCloseTo(0.8 * 20 * u((n + 1) % 2 ** 32), 9)
      }
    }
  })
})

describe('moveStraightLetters', () => {
  const bounce = { style: 'wavy', amount: 100, seed: 1 } as const
  const box = (more: Record<string, unknown>) => {
    const laid = layoutText(ck, textOf('Up and down\nwe go', more), resources)
    const placed = laid.placed ?? placeLetters(ck, laid, inPlace)
    const size = { width: laid.width, height: laid.height, bounds: placedBounds(placed.runs) }
    if (placed !== laid.placed) placed.delete()
    laid.delete()
    return size
  }

  it('grows an auto width box to hold the moved letters both ways, from its corner', () => {
    const straight = box({ boxMode: 'autoWidth' })
    const bounced = box({ boxMode: 'autoWidth', bounce })
    expect(bounced.width).toBeGreaterThanOrEqual(straight.width)
    expect(bounced.height).toBeGreaterThan(straight.height + 10)
    const { bounds } = bounced
    if (!bounds) throw new Error('not placed')
    expect(bounds.x).toBeGreaterThanOrEqual(-0.01)
    expect(bounds.y).toBeGreaterThanOrEqual(-0.01)
    // The letters reach past the box's bottom no further than the straight letters reach past the straight box's.
    const below = (size: typeof straight) => (size.bounds?.y ?? 0) + (size.bounds?.height ?? 0) - size.height
    expect(below(bounced)).toBeLessThanOrEqual(Math.max(0, below(straight)) + 0.01)
  })

  it('grows an auto height box in height only, and leaves a fixed box as set', () => {
    const straight = box({ boxMode: 'autoHeight', width: 300 })
    const bounced = box({ boxMode: 'autoHeight', width: 300, bounce })
    expect(bounced.width).toBe(300)
    expect(bounced.height).toBeGreaterThan(straight.height + 10)
    expect(bounced.bounds?.y).toBeGreaterThanOrEqual(-0.01)
    const fixed = box({ bounce })
    expect(fixed).toMatchObject({ width: 1000, height: box({}).height })
  })

  it('holds a raised or lowered letter as it is drawn: a raise never shrinks the box, and one past it grows it', () => {
    const wavy = { boxMode: 'autoHeight', width: 300, bounce: { ...bounce, amount: 30 } }
    const plain = box(wavy)
    // A letter of the first line raised, past the top, or of the last lowered, past the bottom.
    const raisedBy = (raise: number) => {
      const at = raise > 0 ? 1 : 13
      return box({ ...wavy, runs: [{ start: at, end: at + 1, style: { raise } }] })
    }
    for (const raise of [-30, 30]) expect(raisedBy(raise).height).toBeGreaterThanOrEqual(plain.height)
    for (const raise of [-100, 100]) expect(raisedBy(raise).height).toBeGreaterThan(plain.height + 10)
    // The lowered letter reaches past the box's bottom no further than the letters reach past it unraised.
    const below = (size: typeof plain) => (size.bounds?.y ?? 0) + (size.bounds?.height ?? 0) - size.height
    expect(below(raisedBy(-100))).toBeLessThanOrEqual(Math.max(0, below(plain)) + 0.01)
  })

  it('keeps the straight box at amount 0', () => {
    for (const boxMode of ['autoWidth', 'autoHeight']) {
      const straight = box({ boxMode, width: 300 })
      const still = box({ boxMode, width: 300, bounce: { ...bounce, amount: 0 } })
      expect([still.width, still.height]).toEqual([straight.width, straight.height])
    }
  })
})

describe('moveLetters', () => {
  it('raises each wavy letter by sin(i·π/3) of half its font size, counting no space', () => {
    const glyphs = moved(textOf('AB CD EF', { bounce: { style: 'wavy', amount: 60, seed: 1 } }))
    const letters = [0, 1, -1, 2, 3, -1, 4, 5]
    for (const g of glyphs) {
      const i = letters[g.offset] ?? -1
      const raise = i < 0 ? 0 : Math.sin((i * Math.PI) / 3) * 0.6 * 20
      expectXform(g.xform, expected(g.straight, g.advance, raise, 0))
    }
  })

  it('raises and turns each random letter about the middle of its advance by mulberry32 of the seed and its count', () => {
    const glyphs = moved(textOf('Sale now', { bounce: { style: 'random', amount: 70, seed: 9 } }))
    const letters = [0, 1, 2, 3, -1, 4, 5, 6]
    for (const g of glyphs) {
      const i = letters[g.offset] ?? -1
      if (i < 0) {
        expectXform(g.xform, g.straight)
        continue
      }
      const n = 9 * 65537 + 2 * i
      expectXform(g.xform, expected(g.straight, g.advance, u(n) * 0.7 * 20, 0.7 * 20 * u(n + 1)))
    }
  })

  it('places a text the same for the same seed, and otherwise for another', () => {
    const at = (seed: number) => moved(textOf('Bounce', { bounce: { style: 'random', amount: 50, seed } }))
    expect(at(3)).toEqual(at(3))
    expect(at(4).map((g) => g.xform)).not.toEqual(at(3).map((g) => g.xform))
  })

  it('turns a run’s letters by its letter turn, added to the bounce’s, sized by their own font size', () => {
    const glyphs = moved(
      textOf('Wow', {
        bounce: { style: 'wavy', amount: 100, seed: 1 },
        runs: [{ start: 1, end: 2, style: { turn: -30, fontSize: 60 } }],
      }),
    )
    const [w, o, w2] = glyphs as [Moved, Moved, Moved]
    expectXform(w.xform, expected(w.straight, w.advance, 0, 0))
    expectXform(o.xform, expected(o.straight, o.advance, Math.sin(Math.PI / 3) * 30, -30))
    expectXform(w2.xform, expected(w2.straight, w2.advance, Math.sin((2 * Math.PI) / 3) * 20, 0))
  })

  it('moves the glyphs of one grapheme together, as one letter', () => {
    // क्ष is one grapheme of three characters drawn as one or more glyphs; ा joins the next letter.
    const glyphs = moved(textOf('क्षमा', { bounce: { style: 'wavy', amount: 100, seed: 1 } }))
    const lifts = glyphs.map((g) => {
      const [x, y] = placedPoint(g.xform, 0, 0)
      const [sx, sy] = placedPoint(g.straight, 0, 0)
      return { offset: g.offset, dx: x - sx, dy: y - sy }
    })
    for (const lift of lifts.filter((l) => l.offset < 3)) expect(lift.dy).toBeCloseTo(0, 3)
    for (const lift of lifts.filter((l) => l.offset >= 3)) expect(lift.dy).toBeCloseTo(-Math.sin(Math.PI / 3) * 20, 3)
  })

  it('bounces a curved text’s letters along the curve’s normal', () => {
    const curve = { shape: 'arcUp', amount: 60 } as const
    const props = textOf('ARCH', { curve, bounce: { style: 'wavy', amount: 100, seed: 1 } })
    const bounced = layoutText(ck, props, resources)
    const flat = { ...props }
    delete flat.bounce
    const curved = layoutText(ck, flat, resources)
    const pairs = (bounced.placed?.runs ?? []).flatMap((run, r) =>
      [...run.offsets].map((offset, i) => ({
        offset,
        advance: run.advances[i] ?? 0,
        a: [...run.xforms.subarray(4 * i, 4 * i + 4)],
        b: [...(curved.placed?.runs[r]?.xforms.subarray(4 * i, 4 * i + 4) ?? [])],
      })),
    )
    bounced.delete()
    curved.delete()
    const moves = pairs.map(({ offset, advance, a, b }) => {
      const [ax, ay] = placedPoint(a, advance / 2, 0)
      const [bx, by] = placedPoint(b, advance / 2, 0)
      return {
        offset,
        dx: ax - bx,
        dy: ay - by,
        cos: b[0] ?? 1,
        sin: b[1] ?? 0,
        turn: Math.atan2(a[1] ?? 0, a[0] ?? 1) - Math.atan2(b[1] ?? 0, b[0] ?? 1),
      }
    })
    // The first letter isn't raised, so its move is how far the box's corner moved the whole text.
    const corner = moves[0] as (typeof moves)[number]
    for (const m of moves) {
      expect(m.turn).toBeCloseTo(0, 4)
      // How far the letter moved along the curve's normal there, up for a positive value.
      const up = (m.dx - corner.dx) * m.sin - (m.dy - corner.dy) * m.cos
      expect(up).toBeCloseTo(Math.sin((m.offset * Math.PI) / 3) * 20, 2)
    }
  })
})
