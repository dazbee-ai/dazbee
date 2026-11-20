import { beforeEach, describe, expect, it } from 'vitest'

import { LAYER_CLIPBOARD_TYPE, LayerClipboard, type LayerStyle } from '@dazbee/schema'

import { copyPayload, keepStyle, layersOnClipboard, rememberedLayers, rememberedStyle } from './clipboard.ts'

/** The key the copied layers are kept under; stored on people's devices, so it never changes. */
const KEY = 'dazbee.copiedLayers'

const rect = (name: string, index: string, link: string) => ({
  type: 'graphic',
  parentId: 'sq',
  link,
  index,
  name,
  props: { x: 0, y: 0, width: 10, height: 10, shape: { kind: 'rect' } },
})
/** Two layers copied from frame `sq` on page `p1`, each with its own link id. */
const copied = LayerClipboard.parse({
  kind: 'dazbee.layers',
  designId: 'd1',
  pageId: 'p1',
  frameId: 'sq',
  tree: { nodes: { a: rect('Logo', 'a0', 'a'), b: rect('', 'a1', 'b') }, roots: ['a', 'b'] },
})
const json = JSON.stringify(copied)
const plain = 'Logo\nLayer'

/** The remembered values held in a map; `failing` throws on every call, as a browser with storage off does. */
function remembering(failing = false) {
  const items = new Map<string, string>()
  const check = () => {
    if (failing) throw new Error('storage is off')
  }
  return {
    items,
    get: (key: string) => (check(), items.get(key) ?? null),
    set: (key: string, value: string) => (check(), void items.set(key, value)),
  }
}

let kept: ReturnType<typeof remembering>
beforeEach(() => {
  kept = remembering()
})

describe('copyPayload', () => {
  it('gives the layers as a payload, in our type and their names as plain text, and keeps them on this device', () => {
    expect(copyPayload(kept, copied)).toEqual({
      payload: { text: plain, data: { [LAYER_CLIPBOARD_TYPE]: json } },
      kept: true,
    })
    expect([...kept.items]).toEqual([[KEY, JSON.stringify({ plain, json })]])
  })

  it('still gives the payload when the device keeps nothing, and says so', () => {
    expect(copyPayload(remembering(true), copied)).toEqual({
      payload: { text: plain, data: { [LAYER_CLIPBOARD_TYPE]: json } },
      kept: false,
    })
  })
})

describe('layersOnClipboard', () => {
  it('reads layers in our type, with the design, page and frame they came from', () => {
    expect(layersOnClipboard(kept, { data: { [LAYER_CLIPBOARD_TYPE]: json } })).toEqual(copied)
    expect(layersOnClipboard(kept, copyPayload(kept, copied).payload)).toEqual(copied)
  })

  it('reads the kept copy when the payload brings only the plain text it wrote', () => {
    copyPayload(kept, copied)
    expect(layersOnClipboard(kept, { text: plain })).toEqual(copied)
    expect(layersOnClipboard(kept, { text: plain, data: { [LAYER_CLIPBOARD_TYPE]: '' } })).toEqual(copied)
    expect(layersOnClipboard(kept, { text: 'something else' })).toBeNull()
  })

  it('reads layers copied by a tab built before letter spacing had a unit, carried over', () => {
    const style = { fontFamily: 'Noto Sans', fontSize: 20, color: '#111111FF', letterSpacing: 3 }
    const text = {
      ...rect('Title', 'a0', 't'),
      type: 'text',
      props: { x: 0, y: 0, width: 10, height: 10, text: 'A', style },
    }
    const old = JSON.stringify({ ...copied, tree: { nodes: { t: text }, roots: ['t'] } })
    const read = layersOnClipboard(kept, { data: { [LAYER_CLIPBOARD_TYPE]: old } })
    expect(read?.tree.nodes.t).toMatchObject({ props: { style: { letterSpacing: { unit: 'px', value: 3 } } } })
  })

  it('finds nothing in an empty payload, in text that isn’t layers or with storage off', () => {
    expect(layersOnClipboard(kept, {})).toBeNull()
    expect(layersOnClipboard(kept, { text: '', data: {} })).toBeNull()
    expect(layersOnClipboard(kept, { data: { [LAYER_CLIPBOARD_TYPE]: '{not json' } })).toBeNull()
    expect(layersOnClipboard(kept, { data: { [LAYER_CLIPBOARD_TYPE]: JSON.stringify({ kind: 'other' }) } })).toBeNull()
    kept.set(KEY, JSON.stringify({ plain, json }))
    expect(layersOnClipboard(remembering(true), { text: plain })).toBeNull()
  })
})

describe('rememberedLayers', () => {
  it('reads the layers last kept on this device', () => {
    expect(rememberedLayers(kept)).toBeNull()
    copyPayload(kept, copied)
    expect(rememberedLayers(kept)).toEqual(copied)
  })

  it('finds nothing in a kept value it can’t read or with storage off', () => {
    kept.items.set(KEY, '{not json')
    expect(rememberedLayers(kept)).toBeNull()
    kept.items.set(KEY, JSON.stringify({ plain, json: JSON.stringify({ kind: 'other' }) }))
    expect(rememberedLayers(kept)).toBeNull()
    expect(rememberedLayers(remembering(true))).toBeNull()
  })
})

describe('keepStyle and rememberedStyle', () => {
  const style: LayerStyle = {
    fills: [{ type: 'solid', color: '#E0262BFF' }],
    effects: [],
    opacity: 0.5,
    blendMode: 'normal',
    bindings: { fill: 'brand:primary' },
  }

  it('keeps a copied style on this device and reads it back', () => {
    expect(rememberedStyle(kept)).toBeNull()
    expect(keepStyle(kept, style)).toBe(true)
    expect(kept.items.get('dazbee.copiedStyle')).toBe(JSON.stringify(style))
    expect(rememberedStyle(kept)).toEqual(style)
  })

  it('finds nothing in a kept value it can’t read, and keeps nothing with storage off', () => {
    kept.items.set('dazbee.copiedStyle', '{"opacity": 7}')
    expect(rememberedStyle(kept)).toBeNull()
    expect(keepStyle(remembering(true), style)).toBe(false)
    expect(rememberedStyle(remembering(true))).toBeNull()
  })
})
