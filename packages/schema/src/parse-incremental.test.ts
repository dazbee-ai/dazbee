import { describe, expect, it } from 'vitest'

import { parseLayer } from './parse-incremental.ts'
import { minimal, storedText } from './test-design.ts'

describe('parseLayer', () => {
  it('reuses the validated layer for a layer object seen before, and validates a replaced one again', () => {
    const raw = minimal().nodes.r1
    const first = parseLayer(raw)
    const again = parseLayer(raw)
    const replaced = parseLayer({ ...raw, props: { ...raw.props, x: 5 } })
    if (!first.success || !again.success || !replaced.success) throw new Error('expected each to parse')
    expect(again.layer).toBe(first.layer)
    expect(replaced.layer).not.toBe(first.layer)
    expect(replaced.layer.props.x).toBe(5)
  })

  it('accepts its own output as input and returns the same layer, which cannot be changed', () => {
    const first = parseLayer(minimal().nodes.r1)
    if (!first.success) throw new Error('expected a layer')
    expect(parseLayer(first.layer)).toEqual({ success: true, layer: first.layer })
    expect(Object.isFrozen(first.layer.props)).toBe(true)
  })

  it('reads a layer stored before letter spacing had a unit, carried over to pixels with their unit', () => {
    const layer = parseLayer(storedText())
    expect(layer.success && layer.layer.type === 'text' && layer.layer.props.style.letterSpacing).toEqual({
      unit: 'px',
      value: 2,
    })
  })

  it('gives the issues of a layer the schema does not take, each as path: message', () => {
    const raw = minimal().nodes.r1
    expect(parseLayer({ ...raw, props: { ...raw.props, width: -1 } })).toEqual({
      success: false,
      errors: ['props.width: Too small: expected number to be >=0'],
    })
  })
})
