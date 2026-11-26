// The open-time check on the canvas tools at their full weight, beside the big carousel's: a page of
// 200 frames in 20 sections with 200 connectors opens from the sync server's welcome in under 300 ms
// (ADR-0014's bound).
import { describe, expect, it } from 'vitest'

import type { Session } from '@dazbee/doc'
import { holdOf } from '@dazbee/doc/test-holds'
import { connectorsOf, framesInSection, parseDesign, sectionsByPlace } from '@dazbee/schema'

import { canvasTools } from './canvas-tools.ts'
import { openWelcomed, welcomeText } from './welcomed.ts'

const MAX_OPEN_MS = 300

const parsed = () => {
  const result = parseDesign(canvasTools())
  if (!result.success) throw new Error(result.errors.join('\n'))
  return result.design
}

describe('canvasTools', () => {
  it('is one page of 200 frames in 20 sections of ten, top to bottom, joined by 200 drawn connectors', () => {
    const design = parsed()
    expect(Object.keys(design.frames)).toHaveLength(200)
    expect(Object.keys(design.nodes)).toHaveLength(600)
    const sections = sectionsByPlace(design, 'p1')
    expect(sections.map(([id]) => id)).toEqual(Array.from({ length: 20 }, (_, i) => `s${i + 1}`))
    expect(sections.every(([id]) => framesInSection(design, id).length === 10)).toBe(true)
    expect(connectorsOf(design, 'p1')).toHaveLength(200)
    expect(Object.values(design.frames).filter((frame) => frame.starred)).toHaveLength(20)
  })

  it('opens from its welcome in under 300 ms', () => {
    const welcome = welcomeText(parsed())
    const runs = Array.from({ length: 5 }, () => {
      let tab: Session | undefined
      const ms = holdOf(() => {
        tab = openWelcomed(welcome)
      })
      expect(Object.keys(tab?.design().connectors ?? {})).toHaveLength(200)
      tab?.destroy()
      return ms
    })
    const median = [...runs].sort((a, b) => a - b)[2] ?? Infinity
    expect(median, `open times ${runs.map((ms) => ms.toFixed(0)).join(', ')} ms`).toBeLessThan(MAX_OPEN_MS)
  })
})
