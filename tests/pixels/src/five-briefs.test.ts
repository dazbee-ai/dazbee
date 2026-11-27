// The AI flow's opening goal (spec #317): a design of five briefs, twenty drafts in five sections, each draft's
// picture arrived, opens from the sync server's welcome in under 300 ms (ADR-0014).
import { describe, expect, it } from 'vitest'

import type { Session } from '@dazbee/doc'
import { holdOf } from '@dazbee/doc/test-holds'
import { briefDesignOf, type DesignInput, parseDesign, pictureLayerOf } from '@dazbee/schema'

import { openWelcomed, welcomeText } from './welcomed.ts'

const MAX_OPEN_MS = 300
const BRIEFS = 5

/** Five briefs of four square drafts, one below another, each draft showing its arrived picture. */
function fiveBriefs(): DesignInput {
  const briefs = Array.from({ length: BRIEFS }, (_, b) => {
    const frames = [0, 1, 2, 3].map((n) => ({ frameId: `b${b}-f${n}`, pictureLayerId: pictureLayerOf(`b${b}-f${n}`) }))
    return briefDesignOf(
      { designId: 'd1', name: 'Five briefs' },
      {
        sectionId: `b${b}`,
        frames,
        words: `Brief ${b + 1}`,
        size: { width: 1080, height: 1080 },
        draftName: (n) => `Draft ${n + 1}`,
      },
    )
  })
  const [first] = briefs
  if (!first) throw new Error('no brief')
  return {
    ...first,
    frames: Object.fromEntries(
      briefs.flatMap((design, b) =>
        Object.entries(design.frames).map(([id, frame]) => [id, { ...frame, y: b * 1800 }]),
      ),
    ),
    nodes: Object.fromEntries(
      briefs.flatMap((design) =>
        Object.entries(design.nodes).map(([id, node]) => [
          id,
          { ...node, props: { ...node.props, fills: [{ type: 'image', assetId: `asset-${id}`, fit: 'fill' }] } },
        ]),
      ),
    ),
    sections: Object.fromEntries(
      briefs.flatMap((design, b) =>
        Object.entries(design.sections ?? {}).map(([id, s]) => [id, { ...s, order: `a${b}` }]),
      ),
    ),
  } as DesignInput
}

describe('a design of five briefs', () => {
  it('opens from its welcome in under 300 ms', () => {
    const parsed = parseDesign(fiveBriefs())
    if (!parsed.success) throw new Error(parsed.errors.join('\n'))
    expect(Object.keys(parsed.design.frames)).toHaveLength(20)
    expect(Object.keys(parsed.design.sections)).toHaveLength(5)
    const welcome = welcomeText(parsed.design)
    const runs = Array.from({ length: 5 }, () => {
      let tab: Session | undefined
      const ms = holdOf(() => {
        tab = openWelcomed(welcome)
      })
      expect(Object.keys(tab?.design().frames ?? {})).toHaveLength(20)
      tab?.destroy()
      return ms
    })
    const median = [...runs].sort((a, b) => a - b)[2] ?? Infinity
    expect(median, `open times ${runs.map((ms) => ms.toFixed(1)).join(', ')} ms`).toBeLessThan(MAX_OPEN_MS)
  })
})
