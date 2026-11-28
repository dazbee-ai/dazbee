import { describe, expect, it } from 'vitest'

import type { Pixels } from '@dazbee/renderer'
import { loadCanvasKit } from '@dazbee/renderer/node'
import type { Rgb } from '@dazbee/schema'

import { LOOKS_SAME, shrunk } from '../looks-same/rule.ts'
import { drawGraphics } from './draw-layers.ts'
import { judge, JUDGING, type Seen, withoutUnseen } from './judging.ts'
import { HEIGHT, painted, WIDTH } from './test-matching.ts'
import { ellipse, graphic, hiding, rectangle } from './test-pieces.ts'

const ck = await loadCanvasKit()
const BLUE = '#2563EBFF'
const INK = '#111827FF'
const RED = '#DC2626FF'
const WHITE = '#FFFFFFFF'

/**
 * A piece as the matcher has its rebuilds judged: at its own size and at the rule's, at most 512 px on its long
 * side, with what other layers hide of it (given for a piece no larger than that) and the colour behind it.
 */
const seenOf = (piece: Pixels, around: { hidden?: Uint8Array; behind?: Rgb } = {}): Seen => {
  const scale = Math.min(1, LOOKS_SAME.maxSide / Math.max(piece.width, piece.height))
  const width = Math.max(1, Math.round(piece.width * scale))
  const height = Math.max(1, Math.round(piece.height * scale))
  const small = scale < 1 ? shrunk(piece, width, height) : piece
  return { ck, piece, small, hidden: around.hidden, behind: around.behind }
}

const panelBox = { x: 20, y: 20, width: 160, height: 100 }
const panel = rectangle(panelBox, BLUE, 12)
const badgeBox = { x: 80, y: 50, width: 40, height: 40 }
const badge = rectangle(badgeBox, INK)
/** A dot of 12 px on the panel: too little of the piece for the rule's far share, and plain to see. */
const dot = ellipse({ x: 140, y: 40, width: 12, height: 12 }, INK)
/** A speck of 2 px on the panel, which nobody would miss. */
const speck = rectangle({ x: 150, y: 90, width: 2, height: 2 }, '#1D4ED8FF')
/** A see-through white panel with a white dot on it: over white, the dot can't be seen. */
const glassPanel = graphic({ kind: 'rect', cornerRadius: 12 }, panelBox, {
  fill: { type: 'solid', color: WHITE, opacity: 0.5 },
})
const glassDot = ellipse({ x: 140, y: 40, width: 12, height: 12 }, WHITE)

describe('judge', () => {
  it('finds graphics that draw the piece the same, with none of it far', () => {
    const judged = judge(seenOf(drawGraphics(ck, [panel, badge], WIDTH, HEIGHT)), [panel, badge])
    expect(judged.same).toBe(true)
    expect(judged.scores).toEqual({ far: 0 })
    expect(judged.detail.blob).toBe(0)
  })

  it('finds graphics that miss a shape not the same: a large one by the far share, a small one by its blob', () => {
    const large = judge(seenOf(drawGraphics(ck, [panel, badge], WIDTH, HEIGHT)), [panel])
    expect(large.same).toBe(false)
    expect(large.scores.far).toBeGreaterThan(LOOKS_SAME.shape.far)
    const small = judge(seenOf(drawGraphics(ck, [panel, dot], WIDTH, HEIGHT)), [panel])
    expect(small.same).toBe(false)
    expect(small.scores.far).toBeLessThanOrEqual(LOOKS_SAME.shape.far)
    expect(small.detail.blob).toBeGreaterThan(JUDGING.mostBlob)
  })

  it('judges nothing of what other layers hide', () => {
    const piece = drawGraphics(ck, [panel, badge], WIDTH, HEIGHT)
    const judged = judge(seenOf(piece, { hidden: hiding(badgeBox, WIDTH, HEIGHT) }), [panel])
    expect(judged.same).toBe(true)
    expect(judged.scores).toEqual({ far: 0 })
  })

  it('judges a small piece with a hidden block on it by what shows around the block', () => {
    // A red piece of 100 × 40 px, which is judged enlarged, with a blue block that a layer in front hides.
    const blocked = painted(100, 40, (x, y) =>
      x >= 55 && x < 80 && y >= 12 && y < 28 ? [37, 99, 235, 255] : [220, 38, 38, 255],
    )
    const red = rectangle({ x: 0, y: 0, width: 100, height: 40 }, RED)
    expect(judge(seenOf(blocked), [red]).same).toBe(false)
    const hidden = hiding({ x: 50, y: 8, width: 35, height: 24 }, 100, 40)
    expect(judge(seenOf(blocked, { hidden }), [red]).same).toBe(true)
  })

  it('judges a hairline, a pixel high at the rule’s size, by its graphic drawn at its own size and shrunk', () => {
    for (const [width, height] of [
      [2000, 1],
      [2048, 2],
    ] as const) {
      const hairline = painted(width, height, () => [220, 38, 38, 255])
      const judged = judge(seenOf(hairline), [rectangle({ x: 0, y: 0, width, height }, RED)])
      expect(judged.same).toBe(true)
      expect(judged.scores).toEqual({ far: 0 })
    }
  })

  it('judges a see-through piece over the colour behind it', () => {
    // Over the grey a piece is judged on when nothing is known, the dot shows; over white it can't be seen.
    const glass = drawGraphics(ck, [glassPanel, glassDot], WIDTH, HEIGHT)
    expect(judge(seenOf(glass), [glassPanel]).same).toBe(false)
    expect(judge(seenOf(glass, { behind: [255, 255, 255] }), [glassPanel]).same).toBe(true)
  })
})

describe('withoutUnseen', () => {
  it('drops a graphic too small to be missed, and judges the rest', () => {
    const seen = seenOf(drawGraphics(ck, [panel, speck], WIDTH, HEIGHT))
    const fewer = withoutUnseen(seen, [panel, speck], [16_000, 4], undefined)
    expect(fewer?.layers).toEqual([panel])
    expect(fewer?.judged.same).toBe(true)
  })

  it('gives null when no graphic is small, and when the small one would be missed', () => {
    const large = seenOf(drawGraphics(ck, [panel, badge], WIDTH, HEIGHT))
    expect(withoutUnseen(large, [panel, badge], [14_400, 1600], undefined)).toBeNull()
    // A dot of 8 px draws 50 of the piece's pixels, under the share that is small, and is plain to see.
    const mark = ellipse({ x: 140, y: 40, width: 8, height: 8 }, INK)
    const marked = seenOf(drawGraphics(ck, [panel, mark], WIDTH, HEIGHT))
    expect(withoutUnseen(marked, [panel, mark], [16_000, 50], undefined)).toBeNull()
  })
})
