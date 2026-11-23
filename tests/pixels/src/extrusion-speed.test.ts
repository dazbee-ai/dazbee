// The speed check for extrusions: a 40-character headline drawn on the CPU surface, and into a
// PDF, with its 3D sides takes at most 3× the same headline without them. Each draw lays its words out anew,
// as an export does, and the two are timed in turn by the process's CPU time, a few draws a sample,
// as Windows counts CPU time in steps of about 16 ms.
import { describe, expect, it } from 'vitest'

import { renderPixels, renderVector, resourceCache } from '@dazbee/renderer'
import { loadCanvasKit } from '@dazbee/renderer/node'

import { quantile } from './flow-drag-speed.ts'
import { fixtureResources } from './pixels.ts'

/** The most a 3D headline may take, in times the plain one's median. */
const MOST = 3
/** Draws a sample, and samples of each kind timed. */
const DRAWS = 5
const SAMPLES = 15

const ck = await loadCanvasKit()
const bytes = fixtureResources()
const cache = resourceCache(ck)

/** A frame of one heavy 40-character headline, its words new for each `round`, with 3D sides or without. */
function headline(round: number, extruded: boolean) {
  const text = `BIG SUMMER SALE ${String(round).padStart(4, '0')} OFF EVERYTHING NOW!`
  return {
    meta: { designId: 'speed', name: '3D speed' },
    pages: { p: { name: 'Page', order: 'a0' } },
    frames: {
      f: {
        pageId: 'p',
        name: 'F',
        width: 1080,
        height: 400,
        x: 0,
        y: 0,
        order: 'a0',
        fills: [{ type: 'solid', color: '#F4F1EAFF' }],
      },
    },
    nodes: {
      t: {
        type: 'text',
        parentId: 'f',
        link: 't',
        index: 'a0',
        name: 'Headline',
        props: {
          x: 40,
          y: 40,
          width: 1000,
          height: 300,
          boxMode: 'autoHeight',
          text,
          style: { fontFamily: 'Noto Sans', fontWeight: 800, fontSize: 72, color: '#E53935FF' },
          ...(extruded ? { extrusion: { depth: 15, angle: 45 } } : {}),
        },
      },
    },
  }
}

/** The median CPU time of a draw, plain and with 3D sides, timed in turn. */
function timed(draw: (json: object) => void) {
  const ms: Record<'plain' | 'extruded', number[]> = { plain: [], extruded: [] }
  for (let round = 0; round < 2; round++) for (const extruded of [false, true]) draw(headline(-1 - round, extruded))
  for (let sample = 0; sample < SAMPLES; sample++)
    for (const kind of ['plain', 'extruded'] as const) {
      const start = process.cpuUsage()
      for (let i = 0; i < DRAWS; i++) draw(headline(sample * DRAWS + i, kind === 'extruded'))
      const used = process.cpuUsage(start)
      ms[kind].push((used.user + used.system) / 1000 / DRAWS)
    }
  return { plain: quantile(ms.plain, 0.5), extruded: quantile(ms.extruded, 0.5) }
}

describe('an extrusion', () => {
  it('has 40 characters in the headline timed', () => {
    expect(headline(0, true).nodes.t.props.text).toHaveLength(40)
  })

  it.each([
    ['on the CPU surface', (json: object) => renderPixels(ck, json, 'f', bytes, cache, 1)],
    ['into a PDF', (json: object) => renderVector(ck, json, 'f', bytes, 'pdf', cache)],
  ] as const)('draws a 40-character headline with its sides %s in at most 3× its time without them', (where, draw) => {
    const { plain, extruded } = timed(draw)
    const said = `${where}: plain ${plain.toFixed(1)} ms, 3D ${extruded.toFixed(1)} ms (${(extruded / plain).toFixed(2)}×)`
    console.log(said)
    expect(extruded, said).toBeLessThanOrEqual(MOST * plain)
  })
})
