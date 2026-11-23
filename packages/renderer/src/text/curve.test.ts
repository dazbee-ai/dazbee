import { describe, expect, it } from 'vitest'

import { FALLBACK_FAMILIES } from '@dazbee/fonts'
import { loadFontFiles } from '@dazbee/fonts/node'
import { type TextCurve, TextProps } from '@dazbee/schema'

import { loadCanvasKit } from '../node.ts'
import { resourceCache } from '../resources.ts'
import { curveLetters } from './curve.ts'
import { layoutText } from './layout.ts'
import { inPlace, placedPoint, placeLetters } from './placed.ts'

const ck = await loadCanvasKit()
const resources = resourceCache(ck).resources({
  fonts: loadFontFiles(),
  fallbackFamilies: [...FALLBACK_FAMILIES],
  images: {},
})

/** A placed glyph: the middle of its advance on its baseline, its angle, and where the straight layout has it. */
interface Glyph {
  x: number
  y: number
  angle: number
  advance: number
  /** The middle of its advance across the straight layout, and its baseline there. */
  straightX: number
  baseline: number
}

/**
 * `text` in Noto Sans at 40 px, laid out straight and curved: each glyph placed, the straight lines'
 * lengths and baselines, and the curved box.
 */
function curved(text: string, curve: TextCurve, more: Record<string, unknown> = {}) {
  const props = TextProps.parse({
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    boxMode: 'autoWidth',
    text,
    style: { fontFamily: 'Noto Sans', fontSize: 40, color: '#000000FF' },
    ...more,
  })
  const straight = layoutText(ck, props, resources)
  const lines = straight.blocks.flatMap((b) =>
    b.paragraph.getLineMetrics().map((m) => ({ left: b.x + m.left, width: m.width, baseline: b.y + m.baseline })),
  )
  const flat = placeLetters(ck, straight, inPlace)
  const { placed, width, height } = curveLetters(ck, straight, curve, props.style.fontSize)
  const glyphs: Glyph[] = []
  placed.runs.forEach((run, r) => {
    const flatRun = flat.runs[r]
    if (!flatRun) throw new Error('the straight placement has other runs')
    for (let i = 0; i < run.glyphs.length; i++) {
      const xform = run.xforms.subarray(4 * i, 4 * i + 4)
      const advance = run.advances[i] ?? 0
      const [x, y] = placedPoint(xform, advance / 2, 0)
      const [sx = 0, sy = 0] = [flatRun.xforms[4 * i + 2], flatRun.xforms[4 * i + 3]]
      glyphs.push({
        x,
        y,
        angle: Math.atan2(xform[1] ?? 0, xform[0] ?? 1),
        advance,
        straightX: sx + advance / 2,
        baseline: sy,
      })
    }
  })
  const boxes = placed.runs.flatMap((run) => [...run.boxes])
  placed.delete()
  flat.delete()
  straight.delete()
  return { glyphs, lines, width, height, boxes }
}

/** The glyphs of the line whose straight baseline is the `n`th from the top. */
const lineOf = (glyphs: readonly Glyph[], n: number) => {
  const baselines = [...new Set(glyphs.map((g) => g.baseline))].sort((a, b) => a - b)
  return glyphs.filter((g) => g.baseline === baselines[n])
}

/** The centre a glyph's circle has, from its point and angle: below it for an arc up or a circle, above for an arc down. */
const centreOf = (g: Glyph, r: number, up: boolean) =>
  up
    ? [g.x - r * Math.sin(g.angle), g.y + r * Math.cos(g.angle)]
    : [g.x + r * Math.sin(g.angle), g.y - r * Math.cos(g.angle)]

/** The longest line's length. */
const longestOf = (lines: readonly { width: number }[]) => Math.max(...lines.map((l) => l.width))

/** `x` at which `y = −a·sin(k·x)` from 0 has run `s` along, and its slope there, by small steps. */
function alongSine(a: number, k: number, s: number): { x: number; y: number; slope: number } {
  const speed = (x: number) => Math.hypot(1, a * k * Math.cos(k * x))
  let [x, run] = [0, 0]
  const h = 0.001
  while (run + speed(x + h / 2) * h < s) {
    run += speed(x + h / 2) * h
    x += h
  }
  x += (s - run) / speed(x)
  return { x, y: -a * Math.sin(k * x), slope: -a * k * Math.cos(k * x) }
}

describe('curveLetters', () => {
  it('sets an arc up of amount × 1.8° on the longest line, each letter turned to the arc at the middle of its advance', () => {
    for (const amount of [20, 100]) {
      const { glyphs, lines } = curved('CURVED TEXT', { shape: 'arcUp', amount })
      const length = longestOf(lines)
      const sweep = (amount / 100) * Math.PI
      const r = length / sweep
      const middle = (lines[0]?.left ?? 0) + length / 2
      const [cx = 0, cy = 0] = centreOf(glyphs[0] as Glyph, r, true)
      for (const g of glyphs) {
        const [x, y] = centreOf(g, r, true)
        expect(x).toBeCloseTo(cx, 2)
        expect(y).toBeCloseTo(cy, 2)
        expect(g.angle).toBeCloseTo((g.straightX - middle) / r, 4)
      }
      // The ends of the longest line span the whole sweep.
      const [first, last] = [glyphs[0] as Glyph, glyphs.at(-1) as Glyph]
      expect(first.angle - first.advance / 2 / r).toBeCloseTo(-sweep / 2, 2)
      expect(last.angle + last.advance / 2 / r).toBeCloseTo(sweep / 2, 2)
    }
  })

  it('sets an arc down as the same arc mirrored, its middle lowest', () => {
    const { glyphs, lines } = curved('CURVED TEXT', { shape: 'arcDown', amount: 60 })
    const length = longestOf(lines)
    const r = length / (0.6 * Math.PI)
    const middle = (lines[0]?.left ?? 0) + length / 2
    const [cx = 0, cy = 0] = centreOf(glyphs[0] as Glyph, r, false)
    for (const g of glyphs) {
      const [x, y] = centreOf(g, r, false)
      expect(x).toBeCloseTo(cx, 2)
      expect(y).toBeCloseTo(cy, 2)
      expect(g.angle).toBeCloseTo(-(g.straightX - middle) / r, 4)
      expect(g.y).toBeGreaterThan(cy)
    }
  })

  it('sets the longest line round a circle of its length × (2 − amount / 100), centred at the top, its letters spread to close it', () => {
    for (const amount of [0, 30, 100]) {
      const { glyphs, lines } = curved('ROUND BADGE', { shape: 'circle', amount })
      const length = longestOf(lines)
      const r = (length * (2 - amount / 100)) / (2 * Math.PI)
      const middle = (lines[0]?.left ?? 0) + length / 2
      const [cx = 0, cy = 0] = centreOf(glyphs[0] as Glyph, r, true)
      for (const g of glyphs) {
        const [x, y] = centreOf(g, r, true)
        expect(x).toBeCloseTo(cx, 2)
        expect(y).toBeCloseTo(cy, 2)
        expect(g.angle).toBeCloseTo(((g.straightX - middle) * 2 * Math.PI) / length, 4)
      }
    }
  })

  it('sets a wave y = −A·sin(2π·x / λ), A the amount’s share of the font size and λ six of it, each letter its distance along it', () => {
    const { glyphs, lines } = curved('WAVY OFFER TODAY', { shape: 'wave', amount: 80 })
    const [a, k] = [0.8 * 40, (2 * Math.PI) / (6 * 40)]
    const start = lines[0]?.left ?? 0
    const first = glyphs[0] as Glyph
    const origin = alongSine(a, k, first.straightX - start)
    for (const g of glyphs) {
      const on = alongSine(a, k, g.straightX - start)
      expect(g.x - first.x).toBeCloseTo(on.x - origin.x, 1)
      expect(g.y - first.y).toBeCloseTo(on.y - origin.y, 1)
      expect(g.angle).toBeCloseTo(Math.atan(on.slope), 2)
    }
  })

  it('sets each line on its own parallel curve, one line’s advance further down: a smaller arc up, the wave moved down', () => {
    const arc = curved('BIG SUMMER SALE\nNOW ON', { shape: 'arcUp', amount: 50 }, { align: 'center' })
    const r = longestOf(arc.lines) / (0.5 * Math.PI)
    const step = (arc.lines[1]?.baseline ?? 0) - (arc.lines[0]?.baseline ?? 0)
    const [top, bottom] = [lineOf(arc.glyphs, 0), lineOf(arc.glyphs, 1)]
    const [cx = 0, cy = 0] = centreOf(top[0] as Glyph, r, true)
    for (const g of bottom) {
      const [x, y] = centreOf(g, r - step, true)
      expect(x).toBeCloseTo(cx, 2)
      expect(y).toBeCloseTo(cy, 2)
    }
    const wave = curved('WAVE\nWAVE', { shape: 'wave', amount: 50 })
    const down = (wave.lines[1]?.baseline ?? 0) - (wave.lines[0]?.baseline ?? 0)
    const [upper, lower] = [lineOf(wave.glyphs, 0), lineOf(wave.glyphs, 1)]
    lower.forEach((g, i) => {
      expect(g.x).toBeCloseTo(upper[i]?.x ?? 0, 3)
      expect(g.y - (upper[i]?.y ?? 0)).toBeCloseTo(down, 3)
      expect(g.angle).toBeCloseTo(upper[i]?.angle ?? 0, 5)
    })
  })

  it('closes a line whose arc would be smaller than its own length on a circle of that length', () => {
    const { glyphs, lines } = curved('ONE\nTWO\nTHREE\nFOUR\nFIVE\nSIX', { shape: 'circle', amount: 100 })
    const last = lineOf(glyphs, 5)
    const r = (lines[5]?.width ?? 0) / (2 * Math.PI)
    const [cx = 0, cy = 0] = centreOf(last[0] as Glyph, r, true)
    for (const g of last) {
      const [x, y] = centreOf(g, r, true)
      expect(x).toBeCloseTo(cx, 2)
      expect(y).toBeCloseTo(cy, 2)
    }
  })

  it('keeps each line’s alignment along the arc: its start, middle or end where the longest line’s is', () => {
    const r = (lines: readonly { width: number }[]) => longestOf(lines) / (0.8 * Math.PI)
    const step = (lines: readonly { baseline: number }[]) => (lines[1]?.baseline ?? 0) - (lines[0]?.baseline ?? 0)
    /** The angles at which a line's first glyph starts and its last ends. */
    const ends = (line: readonly Glyph[], radius: number) => {
      const [first, last] = [line[0] as Glyph, line.at(-1) as Glyph]
      return [first.angle - first.advance / 2 / radius, last.angle + last.advance / 2 / radius]
    }
    for (const [align, side] of [
      ['start', 0],
      ['end', 1],
    ] as const) {
      const text = curved('LONG FIRST LINE\nSHORT', { shape: 'arcUp', amount: 80 }, { align })
      const radius = r(text.lines)
      const top = ends(lineOf(text.glyphs, 0), radius)[side] ?? 0
      const bottom = ends(lineOf(text.glyphs, 1), radius - step(text.lines))[side] ?? 0
      expect(bottom).toBeCloseTo(top, 2)
    }
    const centred = curved('LONG FIRST LINE\nSHORT', { shape: 'arcUp', amount: 80 }, { align: 'center' })
    const [from = 0, to = 0] = ends(lineOf(centred.glyphs, 1), r(centred.lines) - step(centred.lines))
    expect((from + to) / 2).toBeCloseTo(0, 2)
  })

  it('moves a raised glyph off the curve along its normal by its baseline shift', () => {
    // Noto Sans has no superscript x, so the run is made up: smaller and raised.
    const sups = [{ start: 5, end: 7, style: { features: { sups: true } } }]
    const flat = curved('RAISEx2', { shape: 'arcUp', amount: 0 }, { runs: sups })
    const shift = (flat.glyphs[5]?.y ?? 0) - (flat.glyphs[0]?.y ?? 0)
    expect(shift).toBeLessThan(-5)
    const { glyphs, lines } = curved('RAISEx2', { shape: 'arcUp', amount: 70 }, { runs: sups })
    const r = longestOf(lines) / (0.7 * Math.PI)
    const [cx = 0, cy = 0] = centreOf(glyphs[0] as Glyph, r, true)
    const raised = glyphs[5] as Glyph
    expect(Math.hypot(raised.x - cx, raised.y - cy)).toBeCloseTo(r - shift, 1)
  })

  it('places letters of an arc or a wave at amount 0 as they are laid out straight, from the box’s corner', () => {
    for (const shape of ['arcUp', 'arcDown', 'wave'] as const) {
      const { glyphs, width, height, boxes } = curved('FLAT\nTEXT', { shape, amount: 0 })
      const dx = (glyphs[0]?.x ?? 0) - (glyphs[0]?.straightX ?? 0)
      const dy = (glyphs[0]?.y ?? 0) - (glyphs[0]?.baseline ?? 0)
      for (const g of glyphs) {
        expect(g.angle).toBe(0)
        expect(g.x - g.straightX).toBeCloseTo(dx, 4)
        expect(g.y - g.baseline).toBeCloseTo(dy, 4)
      }
      const xs = boxes.filter((_, i) => i % 2 === 0)
      const ys = boxes.filter((_, i) => i % 2 === 1)
      expect([Math.min(...xs), Math.min(...ys)].map((v) => +v.toFixed(3))).toEqual([0, 0])
      expect(width).toBe(Math.ceil(Math.max(...xs)))
      expect(height).toBe(Math.ceil(Math.max(...ys)))
    }
  })

  it('keeps the lines of an arc of the least amount apart, as straight text’s, with a box of whole numbers', () => {
    for (const amount of [1e-12, 1e-320]) {
      const { glyphs, lines, width, height } = curved('Hello\nworld two', { shape: 'arcUp', amount })
      expect(Number.isFinite(width) && Number.isFinite(height)).toBe(true)
      const step = (lines[1]?.baseline ?? 0) - (lines[0]?.baseline ?? 0)
      const [top, bottom] = [lineOf(glyphs, 0)[0] as Glyph, lineOf(glyphs, 1)[0] as Glyph]
      expect(bottom.y - top.y).toBeCloseTo(step, 3)
    }
  })

  it('places a curved text from the box’s corner, its box its turned glyph boxes rounded up', () => {
    const { width, height, boxes } = curved('STAMP OF QUALITY', { shape: 'circle', amount: 60 })
    const xs = boxes.filter((_, i) => i % 2 === 0)
    const ys = boxes.filter((_, i) => i % 2 === 1)
    expect(Math.min(...xs)).toBeCloseTo(0, 4)
    expect(Math.min(...ys)).toBeCloseTo(0, 4)
    expect(width).toBe(Math.ceil(Math.max(...xs)))
    expect(height).toBe(Math.ceil(Math.max(...ys)))
    expect(width).toBeGreaterThan(100)
    expect(Math.abs(width - height)).toBeLessThan(40)
  })
})
