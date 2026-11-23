// A curved or bounced text is hit on its placed letters' turned boxes (ADR-0021), never on the straight
// line it was laid out on.
import { describe, expect, it } from 'vitest'

import type { TurnedRect } from '@dazbee/renderer'
import type { Point, TextProps } from '@dazbee/schema'

import { hitTest } from './hit-test.ts'
import { rect, text } from './test-layers.ts'
import { testLooks } from './test-looks.ts'

const looks = testLooks()
const curved = text(
  'curved',
  'OPEN TODAY',
  { x: 0, y: 0, width: 600, height: 400 },
  { curve: { shape: 'arcUp', amount: 100 } },
)
const layers = [rect('under', 0, 0, 600, 400), curved]
const letters = looks.lines(curved.props as TextProps)

/** The layer under a point, by id. */
const idAt = ({ x, y }: Point) => hitTest(layers, { x, y }, looks)?.id
/** A point of a turned box, `along` its width and `down` its height as shares, in its own turned frame. */
function pointOf(box: TurnedRect, along: number, down: number): Point {
  const angle = ((box.turn ?? 0) * Math.PI) / 180
  const [x, y] = [box.width * along, box.height * down]
  return { x: box.x + Math.cos(angle) * x - Math.sin(angle) * y, y: box.y + Math.sin(angle) * x + Math.cos(angle) * y }
}
/** Whether a point is within 4 px of a letter's turned box. */
function nearLetter(p: Point) {
  return letters.some((box) => {
    const angle = ((box.turn ?? 0) * Math.PI) / 180
    const [dx, dy] = [p.x - box.x, p.y - box.y]
    const along = Math.cos(angle) * dx + Math.sin(angle) * dy
    const down = Math.cos(angle) * dy - Math.sin(angle) * dx
    return along > -4 && along < box.width + 4 && down > -4 && down < box.height + 4
  })
}

describe('hitTest on a curved text', () => {
  it('picks it inside each letter’s turned box', () => {
    expect(letters.length).toBeGreaterThan(8)
    for (const letter of letters) {
      for (const along of [0.2, 0.8]) expect(idAt(pointOf(letter, along, 0.5))).toBe('curved')
    }
  })

  it('picks it inside the counter of a turned "O"', () => {
    const [o] = letters
    if (!o) throw new Error('no letters')
    expect(Math.abs(o.turn ?? 0)).toBeGreaterThan(45)
    expect(idAt(pointOf(o, 0.5, 0.55))).toBe('curved')
  })

  it('picks it on a letter drawn past a box not yet fitted to its curve, and nowhere else past it', () => {
    const small = text(
      'small',
      'OPEN TODAY',
      { x: 0, y: 0, width: 60, height: 40 },
      { curve: { shape: 'arcUp', amount: 100 } },
    )
    const under = [rect('under', 0, 0, 600, 400), small]
    const outside = looks
      .lines(small.props as TextProps)
      .map((box) => pointOf(box, 0.5, 0.5))
      .filter((p) => p.x > 60 || p.y > 40)
    expect(outside.length).toBeGreaterThan(3)
    for (const p of outside) expect(hitTest(under, p, looks)?.id).toBe('small')
    expect(hitTest(under, { x: 500, y: 350 }, looks)?.id).toBe('under')
  })

  it('passes to what lies beneath where its line would be drawn straight, away from every letter', () => {
    const [line] = looks.lines({ ...(curved.props as TextProps), curve: undefined })
    if (!line) throw new Error('no straight line')
    const onLine = Array.from({ length: 20 }, (_, i) => ({
      x: line.x + (line.width * (i + 0.5)) / 20,
      y: line.y + line.height / 2,
    }))
    const clear = onLine.filter((p) => !nearLetter(p))
    expect(clear.length).toBeGreaterThan(4)
    for (const p of clear) expect(idAt(p)).toBe('under')
  })
})

describe('hitTest on a bounced text', () => {
  it('picks a fixed box’s text on a letter raised above its box, and on no point past it away from the letters', () => {
    const bounced = text(
      'bounced',
      'BOUNCE',
      { x: 100, y: 100, width: 400, height: 60 },
      { boxMode: 'fixed', bounce: { style: 'wavy', amount: 100, seed: 1 } },
    )
    const under = [rect('under', 0, 0, 600, 400), bounced]
    const above = looks
      .lines(bounced.props as TextProps)
      .map((box) => ({ x: 100 + box.x + box.width / 2, y: 100 + box.y + 2 }))
      .filter((p) => p.y < 100)
    expect(above.length).toBeGreaterThan(1)
    for (const p of above) expect(hitTest(under, p, looks)?.id).toBe('bounced')
    expect(hitTest(under, { x: 550, y: 90 }, looks)?.id).toBe('under')
  })
})
