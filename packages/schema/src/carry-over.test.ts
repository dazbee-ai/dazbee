import { describe, expect, it } from 'vitest'

import { carryOverLayer, carryOverLayers } from './carry-over.ts'
import { parseDesign } from './design.ts'
import { parseLayer } from './parse-incremental.ts'
import { minimal } from './test-design.ts'

/** A text layer as a design stored before letter spacing had a unit held it: pixels as a bare number. */
const storedText = () => ({
  type: 'text',
  parentId: 'sq',
  link: 't1',
  index: 'a1',
  name: 'Headline',
  props: {
    x: 0,
    y: 0,
    width: 300,
    height: 60,
    text: 'Sale',
    style: { fontFamily: 'Noto Sans', fontSize: 40, color: '#111111FF', letterSpacing: 2 },
    runs: [{ start: 0, end: 2, style: { letterSpacing: -1, fontSize: 30 } }],
  },
})

describe('carryOverLayer', () => {
  it('carries letter spacing stored as pixels over to pixels with their unit, in the style and each run', () => {
    expect(carryOverLayer(storedText())).toMatchObject({
      props: {
        style: { letterSpacing: { unit: 'px', value: 2 } },
        runs: [{ start: 0, end: 2, style: { letterSpacing: { unit: 'px', value: -1 }, fontSize: 30 } }],
      },
    })
  })

  it('gives back the same object for a layer that needs no carrying over, and never changes the one given', () => {
    const shape = minimal().nodes.r1
    expect(carryOverLayer(shape)).toBe(shape)
    const current = {
      ...storedText(),
      props: { ...storedText().props, style: { fontSize: 1, letterSpacing: { unit: 'percent', value: 2 } }, runs: [] },
    }
    expect(carryOverLayer(current)).toBe(current)
    const stored = storedText()
    carryOverLayer(stored)
    expect(stored.props.style.letterSpacing).toBe(2)
    for (const odd of [null, 3, 'text', { type: 'text' }, { type: 'text', props: { style: 'x', runs: 'y' } }])
      expect(carryOverLayer(odd)).toBe(odd)
  })
})

describe('carryOverLayers', () => {
  it('carries over every layer of a record of layers, keeping the record when none changes', () => {
    const nodes = { r1: minimal().nodes.r1, t1: storedText() }
    const carried = carryOverLayers(nodes)
    expect(carried.r1).toBe(nodes.r1)
    expect(carried.t1).toMatchObject({ props: { style: { letterSpacing: { unit: 'px', value: 2 } } } })
    const plain = { r1: minimal().nodes.r1 }
    expect(carryOverLayers(plain)).toBe(plain)
  })
})

describe('reading a stored design', () => {
  it('reads a layer stored before letter spacing had a unit, through parseLayer and parseDesign', () => {
    const layer = parseLayer(storedText())
    expect(layer.success && layer.layer.type === 'text' && layer.layer.props.style.letterSpacing).toEqual({
      unit: 'px',
      value: 2,
    })
    const design = parseDesign({ ...minimal(), nodes: { ...minimal().nodes, t1: storedText() } })
    expect(
      design.success && design.design.nodes.t1?.type === 'text' && design.design.nodes.t1.props.runs[0]?.style,
    ).toEqual({ letterSpacing: { unit: 'px', value: -1 }, fontSize: 30 })
  })
})
