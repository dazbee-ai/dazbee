// The caret, a click and a selection on curved and bounced text, which read the placed letters
// (ADR-0021), in English and Arabic on an arc up, a circle and a wave, bounced wavy and random, and
// bounced on an arc.
import { afterAll, describe, expect, it } from 'vitest'

import { FALLBACK_FAMILIES } from '@dazbee/fonts'
import { loadFontFiles } from '@dazbee/fonts/node'
import {
  caretAt,
  caretPosition,
  compositionLines,
  layoutText,
  makeResources,
  selectionBoxes,
  straightLayout,
  type TextLayout,
} from '@dazbee/renderer'
import { loadCanvasKit } from '@dazbee/renderer/node'
import { type TextBounce, type TextCurve, TextProps } from '@dazbee/schema'

const ck = await loadCanvasKit()
const resources = makeResources(ck, { fonts: loadFontFiles(), fallbackFamilies: [...FALLBACK_FAMILIES], images: {} })
afterAll(() => resources.delete())

type Pt = readonly [number, number]

/** A grapheme drawn by one glyph of its own: its offsets, and its glyph's turned box's corners, clockwise from the top left. */
interface Letter {
  text: string
  start: number
  end: number
  corners: [Pt, Pt, Pt, Pt]
}

/** How a case's letters are placed: on a curve, bounced, or both. */
interface Effect {
  name: string
  curve?: TextCurve
  bounce?: TextBounce
}

const EFFECTS: Effect[] = [
  { name: 'arcUp', curve: { shape: 'arcUp', amount: 60 } },
  { name: 'circle', curve: { shape: 'circle', amount: 50 } },
  { name: 'wave', curve: { shape: 'wave', amount: 40 } },
  { name: 'wavy bounce', bounce: { style: 'wavy', amount: 80, seed: 1 } },
  { name: 'random bounce', bounce: { style: 'random', amount: 70, seed: 5 } },
  { name: 'bounced arcUp', curve: { shape: 'arcUp', amount: 40 }, bounce: { style: 'random', amount: 50, seed: 2 } },
]
const WORDS = [
  { label: 'English', text: 'Fresh baked daily', family: 'Noto Sans', rtl: false },
  { label: 'Arabic', text: 'تخفيضات الصيف', family: 'Noto Naskh Arabic', rtl: true },
  { label: 'two English lines', text: 'Fresh baked\ndaily bread', family: 'Noto Sans', rtl: false },
]
// Two lines round a circle this tight close the inner one over the outer, so their letters overlap.
// A bounced lower line's raised letters reach into the upper line's boxes, so a click or a letter's
// underline there can be the upper line's: those cases check the caret and selection only.
const CASES = EFFECTS.flatMap((effect) =>
  WORDS.filter((words) => !(effect.curve?.shape === 'circle' && words.text.includes('\n'))).map((words) => ({
    ...words,
    effect,
    name: `${words.label} ${effect.name}`,
    overlapping: effect.bounce !== undefined && words.text.includes('\n'),
  })),
)

function laidOut(text: string, family: string, effect: Omit<Effect, 'name'> = {}): TextLayout {
  const props = TextProps.parse({
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    boxMode: 'autoWidth',
    text,
    ...effect,
    style: { fontFamily: family, fontSize: 48, color: '#000000FF' },
  })
  return layoutText(ck, props, resources)
}

/**
 * The graphemes drawn by one glyph each, as wide as the grapheme's box in the straight layout,
 * found from the placement's runs and the straight layout's selection boxes.
 */
function lettersOf(laid: TextLayout, text: string): Letter[] {
  const straight = straightLayout(laid)
  const glyphs = (laid.placed?.runs ?? []).flatMap((run) =>
    [...run.advances].map((advance, i) => {
      const at = (c: number): Pt => [run.boxes[8 * i + 2 * c] ?? 0, run.boxes[8 * i + 2 * c + 1] ?? 0]
      return {
        x: run.origins[2 * i] ?? 0,
        y: run.origins[2 * i + 1] ?? 0,
        advance,
        corners: [at(0), at(1), at(2), at(3)] as Letter['corners'],
      }
    }),
  )
  // A mark, of no advance, is drawn over the letter before it.
  const letters = glyphs.filter((g) => g.advance > 0)
  const segments = [...new Intl.Segmenter('und', { granularity: 'grapheme' }).segment(text)]
  return segments.flatMap(({ segment, index }) => {
    const end = index + segment.length
    const [box, ...more] = selectionBoxes(ck, straight, index, end)
    if (!box || more.length > 0 || segment.trim() === '') return []
    const inside = letters.filter(
      (g) => g.x >= box.x - 0.5 && g.x < box.x + box.width - 0.5 && g.y > box.y && g.y < box.y + box.height,
    )
    const [glyph] = inside
    if (!glyph || inside.length !== 1 || Math.abs(glyph.advance - box.width) > 0.5) return []
    return [{ text: segment, start: index, end, corners: glyph.corners }]
  })
}

/** A point of a turned box: `along` its top edge's share, `down` its left edge's share. */
function pointIn([tl, tr, , bl]: Letter['corners'], along: number, down: number): Pt {
  return [
    tl[0] + (tr[0] - tl[0]) * along + (bl[0] - tl[0]) * down,
    tl[1] + (tr[1] - tl[1]) * along + (bl[1] - tl[1]) * down,
  ]
}

/** How far a point is from the line through two points. */
function offLine(p: Pt, a: Pt, b: Pt): number {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]]
  return Math.abs(dx * (p[1] - a[1]) - dy * (p[0] - a[0])) / Math.hypot(dx, dy)
}

/** The direction of a turned box's left edge, top to bottom, and of a caret or box turned `turn` degrees. */
const downOf = ([tl, , , bl]: Letter['corners']): Pt => {
  const length = Math.hypot(bl[0] - tl[0], bl[1] - tl[1])
  return [(bl[0] - tl[0]) / length, (bl[1] - tl[1]) / length]
}
const turnedDown = (turn = 0): Pt => [-Math.sin((turn * Math.PI) / 180), Math.cos((turn * Math.PI) / 180)]

/** Whether a point is inside a box turned `turn` degrees about its corner, within `slack` pixels. */
function inTurned(p: Pt, box: { x: number; y: number; width: number; height: number; turn?: number }, slack = 0.5) {
  const angle = ((box.turn ?? 0) * Math.PI) / 180
  const [dx, dy] = [p[0] - box.x, p[1] - box.y]
  const along = Math.cos(angle) * dx + Math.sin(angle) * dy
  const down = Math.cos(angle) * dy - Math.sin(angle) * dx
  return along >= -slack && along <= box.width + slack && down >= -slack && down <= box.height + slack
}

describe.each(CASES)('on $name', ({ text, family, effect, rtl, overlapping }) => {
  const laid = laidOut(text, family, effect)
  afterAll(() => laid.delete())
  const letters = lettersOf(laid, text)

  it('finds letters of one glyph each to check, turned or raised more than a little', () => {
    expect(letters.length).toBeGreaterThanOrEqual(5)
    const turns = letters.map((l) => Math.abs(Math.atan2(downOf(l.corners)[0], downOf(l.corners)[1])))
    const tops = letters.map((l) => l.corners[0][1])
    expect(Math.max(...turns) > 0.2 || Math.max(...tops) - Math.min(...tops) > 10).toBe(true)
  })

  it('draws the caret after each letter on its trailing edge, and before it on its leading edge, turned with it', () => {
    for (const letter of letters) {
      const [tl, tr, br, bl] = letter.corners
      const edges = [
        { offset: letter.end, top: rtl ? tl : tr, bottom: rtl ? bl : br, after: false },
        { offset: letter.start, top: rtl ? tr : tl, bottom: rtl ? br : bl, after: true },
      ]
      for (const { offset, top, bottom, after } of edges) {
        const caret = caretPosition(ck, laid, offset, after)
        const [dx, dy] = turnedDown(caret.turn)
        const middle: Pt = [caret.x + (dx * caret.height) / 2, caret.y + (dy * caret.height) / 2]
        expect(offLine([caret.x, caret.y], top, bottom)).toBeLessThan(0.05)
        expect(offLine(middle, top, bottom)).toBeLessThan(0.05)
        const [ex, ey] = downOf(letter.corners)
        expect(dx * ex + dy * ey).toBeCloseTo(1, 4)
      }
    }
  })

  it.skipIf(overlapping)('puts the caret before or after a letter by the half of its turned box a click is in', () => {
    for (const letter of letters) {
      for (const down of [0.2, 0.5, 0.8]) {
        const [lx, ly] = pointIn(letter.corners, 0.25, down)
        const [rx, ry] = pointIn(letter.corners, 0.75, down)
        expect(caretAt(ck, laid, lx, ly)).toBe(rtl ? letter.end : letter.start)
        expect(caretAt(ck, laid, rx, ry)).toBe(rtl ? letter.start : letter.end)
      }
    }
  })

  it.skipIf(overlapping)('a click where the caret is drawn puts it there', () => {
    for (const letter of letters) {
      const caret = caretPosition(ck, laid, letter.end)
      const [dx, dy] = turnedDown(caret.turn)
      const clicked = caretAt(ck, laid, caret.x + (dx * caret.height) / 2, caret.y + (dy * caret.height) / 2)
      const back = caretPosition(ck, laid, clicked)
      expect(Math.hypot(back.x - caret.x, back.y - caret.y)).toBeLessThan(0.5)
    }
  })

  it('covers each selected letter with a box turned with it', () => {
    const boxes = selectionBoxes(ck, laid, 0, text.length)
    expect(boxes.every((b) => b.turn !== undefined)).toBe(true)
    for (const letter of letters) {
      for (const along of [0.1, 0.5, 0.9]) {
        for (const down of [0.1, 0.5, 0.9]) {
          expect(boxes.some((b) => inTurned(pointIn(letter.corners, along, down), b))).toBe(true)
        }
      }
    }
  })

  it('selects only the letters in the range', () => {
    const [letter] = letters.slice(2)
    if (!letter) throw new Error('too few letters')
    const boxes = selectionBoxes(ck, laid, letter.start, letter.end)
    expect(boxes).toHaveLength(1)
    expect(inTurned(pointIn(letter.corners, 0.5, 0.5), boxes[0] ?? { x: 0, y: 0, width: 0, height: 0 })).toBe(true)
  })

  it.skipIf(overlapping)('underlines a composition under each letter, turned with it', () => {
    const lines = compositionLines(ck, laid, 0, text.length)
    for (const letter of letters) {
      const [tl, tr, , bl] = letter.corners
      const box = {
        x: tl[0],
        y: tl[1],
        width: Math.hypot(tr[0] - tl[0], tr[1] - tl[1]),
        height: Math.hypot(bl[0] - tl[0], bl[1] - tl[1]),
        turn: (Math.atan2(tr[1] - tl[1], tr[0] - tl[0]) * 180) / Math.PI,
      }
      const under = lines.filter((line) => {
        const angle = ((line.turn ?? 0) * Math.PI) / 180
        const end: Pt = [line.x + line.width * Math.cos(angle), line.y + line.width * Math.sin(angle)]
        return inTurned([line.x, line.y], box) && inTurned(end, box)
      })
      expect(under).toHaveLength(1)
      expect(under[0]?.turn).toBeCloseTo(box.turn, 3)
    }
  })
})

describe('an empty paragraph on a curve', () => {
  it('draws the caret under the line before, turned with its first letter', () => {
    const laid = laidOut('Fresh\n', 'Noto Sans', { curve: { shape: 'arcUp', amount: 60 } })
    const [f] = lettersOf(laid, 'Fresh\n')
    if (!f) throw new Error('no letters')
    const caret = caretPosition(ck, laid, 6)
    const [ex, ey] = downOf(f.corners)
    const [dx, dy] = turnedDown(caret.turn)
    expect(dx * ex + dy * ey).toBeCloseTo(1, 4)
    // Its top sits on the line through the "F"'s left edge, below the "F".
    const [tl, , , bl] = f.corners
    expect(offLine([caret.x, caret.y], tl, bl)).toBeLessThan(0.05)
    expect((caret.x - bl[0]) * ex + (caret.y - bl[1]) * ey).toBeGreaterThan(-1)
    laid.delete()
  })
})

describe('straight text', () => {
  it('answers with no turn, and is its own straight layout', () => {
    const laid = laidOut('Fresh baked daily', 'Noto Sans')
    expect(straightLayout(laid)).toBe(laid)
    expect('turn' in caretPosition(ck, laid, 3)).toBe(false)
    expect(selectionBoxes(ck, laid, 0, 5).some((b) => 'turn' in b)).toBe(false)
    expect(compositionLines(ck, laid, 0, 5).some((b) => 'turn' in b)).toBe(false)
    laid.delete()
  })
})
