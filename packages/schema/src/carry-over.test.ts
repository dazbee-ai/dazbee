import { describe, expect, it } from 'vitest'

import { carryOverLayer, carryOverLayers, carryOverTextStyle } from './carry-over.ts'
import { parseLayer } from './parse-incremental.ts'
import { minimal, storedText } from './test-design.ts'

/** A text as version 15 stored it, every default written out: a gradient, an outline under its letters, a run, a list and shrink to fit, and no curve. */
const textAt15 = () => ({
  type: 'text',
  parentId: 'sq',
  link: 't15',
  index: 'a1',
  name: 'Badge',
  props: {
    x: 10,
    y: 20,
    width: 300,
    height: 120,
    rotation: 0,
    visible: true,
    opacity: 1,
    blendMode: 'normal',
    effects: [],
    text: 'Big\nsale',
    style: {
      fontFamily: 'Noto Sans',
      fontWeight: 700,
      fontStyle: 'normal',
      fontSize: 40,
      color: '#111111FF',
      letterSpacing: { unit: 'percent', value: 0 },
      outline: { width: 2, color: '#FFFFFFFF', under: true },
      gradient: {
        type: 'linear',
        from: { x: 0, y: 0.5 },
        to: { x: 1, y: 0.5 },
        stops: [
          { offset: 0, color: '#FF0000FF' },
          { offset: 1, color: '#0000FFFF' },
        ],
      },
    },
    runs: [{ start: 0, end: 3, style: { underline: true } }],
    align: 'center',
    direction: 'auto',
    verticalAlign: 'top',
    boxMode: 'fixed',
    wrapStyle: 'balance',
    list: 'bullet',
    maxLines: 2,
    shrinkToFit: { min: 20, max: 40 },
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

  it('reads a text stored at version 20 unchanged, with no extrusion', () => {
    const at15 = textAt15()
    const image = { type: 'image', assetId: 'photo', fit: 'tile', tileScale: 0.5, opacity: 1 }
    const style = { fontFamily: 'Noto Sans', fontWeight: 700, fontStyle: 'normal', fontSize: 40, color: '#111111FF' }
    const stored = {
      ...at15,
      props: {
        ...at15.props,
        style: { ...style, letterSpacing: { unit: 'percent', value: 0 }, image, raise: 10 },
        runs: [{ start: 0, end: 3, style: { color: '#FF0000FF', image: { ...image, fit: 'fill' }, turn: 5 } }],
        bounce: { style: 'random', amount: 30, seed: 2 },
        curve: { shape: 'wave', amount: 20 },
      },
    }
    expect(carryOverLayer(stored)).toBe(stored)
    const parsed = parseLayer(stored)
    expect(parsed).toEqual({ success: true, layer: structuredClone(stored) })
    expect(parsed.success && parsed.layer.props).not.toHaveProperty('extrusion')
  })

  it('reads a text stored at version 19 unchanged, with no image fill', () => {
    const at15 = textAt15()
    const stored = {
      ...at15,
      props: {
        ...at15.props,
        style: { ...at15.props.style, raise: 20 },
        runs: [{ start: 0, end: 3, style: { color: '#FF0000FF', raise: -30, turn: 5 } }],
        curve: { shape: 'arcDown', amount: 20 },
        straightBox: { width: 7.5, height: 3 },
      },
    }
    expect(carryOverLayer(stored)).toBe(stored)
    const parsed = parseLayer(stored)
    expect(parsed).toEqual({ success: true, layer: structuredClone(stored) })
    const text = parsed.success && parsed.layer.type === 'text' ? parsed.layer.props : null
    expect(text?.style).not.toHaveProperty('image')
    expect(text?.runs[0]?.style).not.toHaveProperty('image')
  })

  it('reads a text stored at version 18 unchanged, with no raise', () => {
    const at15 = textAt15()
    const stored = {
      ...at15,
      props: {
        ...at15.props,
        style: { ...at15.props.style, turn: 8 },
        runs: [{ start: 0, end: 3, style: { underline: true, turn: -12 } }],
        bounce: { style: 'wavy', amount: 40, seed: 0 },
        curve: { shape: 'arcUp', amount: 30 },
        straightBox: { width: 7.5, height: 3 },
      },
    }
    expect(carryOverLayer(stored)).toBe(stored)
    const parsed = parseLayer(stored)
    expect(parsed).toEqual({ success: true, layer: structuredClone(stored) })
    const text = parsed.success && parsed.layer.type === 'text' ? parsed.layer.props : null
    expect(text?.style).not.toHaveProperty('raise')
    expect(text?.runs[0]?.style).not.toHaveProperty('raise')
  })

  it('reads a text stored at version 17 unchanged, with no straight box', () => {
    const curve = { shape: 'circle', amount: 50 }
    const stored = { ...textAt15(), props: { ...textAt15().props, boxMode: 'fixed', curve } }
    expect(carryOverLayer(stored)).toBe(stored)
    const parsed = parseLayer(stored)
    expect(parsed).toEqual({ success: true, layer: structuredClone(stored) })
    expect(parsed.success && parsed.layer.props).not.toHaveProperty('straightBox')
  })

  it('reads a text stored at version 16 unchanged, with no bounce or letter turn', () => {
    const stored = { ...textAt15(), props: { ...textAt15().props, curve: { shape: 'wave', amount: 30 } } }
    expect(carryOverLayer(stored)).toBe(stored)
    const parsed = parseLayer(stored)
    expect(parsed).toEqual({ success: true, layer: structuredClone(stored) })
    expect(parsed.success && parsed.layer.props).not.toHaveProperty('bounce')
    expect(parsed.success && parsed.layer.type === 'text' && parsed.layer.props.style).not.toHaveProperty('turn')
  })

  it('reads a text stored at version 15 unchanged, with no curve', () => {
    const stored = textAt15()
    expect(carryOverLayer(stored)).toBe(stored)
    const parsed = parseLayer(stored)
    expect(parsed).toEqual({ success: true, layer: textAt15() })
    expect(parsed.success && parsed.layer.props).not.toHaveProperty('curve')
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
    expect(carryOverTextStyle({ letterSpacing: 0 })).toEqual({ letterSpacing: { unit: 'percent', value: 0 } })
    const current = { letterSpacing: { unit: 'percent', value: 2 } }
    expect(carryOverTextStyle(current)).toBe(current)
    expect(carryOverTextStyle(null)).toBeNull()
  })
})
