import { describe, expect, it } from 'vitest'

import { carryOverLayer, carryOverLayers, carryOverTextStyle } from './carry-over.ts'
import { minimal, storedText } from './test-design.ts'

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

describe('carryOverTextStyle', () => {
  it('carries a copied text look holding letter spacing as pixels over, and leaves any other value', () => {
    expect(carryOverTextStyle({ fontFamily: 'Inter', letterSpacing: 1.5 })).toEqual({
      fontFamily: 'Inter',
      letterSpacing: { unit: 'px', value: 1.5 },
    })
    const current = { letterSpacing: { unit: 'percent', value: 2 } }
    expect(carryOverTextStyle(current)).toBe(current)
    expect(carryOverTextStyle(null)).toBeNull()
  })
})
