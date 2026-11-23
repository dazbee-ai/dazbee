import { describe, expect, it } from 'vitest'

import { FALLBACK_FAMILIES } from '@dazbee/fonts'
import { loadFontFiles } from '@dazbee/fonts/node'
import { TextProps } from '@dazbee/schema'

import { loadCanvasKit } from '../node.ts'
import { resourceCache } from '../resources.ts'
import { paragraphCache, textMeasure } from './cache.ts'
import { layoutText, type TextLayout } from './layout.ts'
import { placedBounds } from './placed.ts'

const ck = await loadCanvasKit()
const resources = () => ({ fonts: ck.FontCollection.Make(), fallbackFamilies: [] })
const text = (value: string) =>
  TextProps.parse({
    x: 0,
    y: 0,
    width: 100,
    height: 20,
    text: value,
    style: { fontFamily: 'Noto Sans', fontSize: 16, color: '#000000FF' },
  })
const freed = (laid: TextLayout) => laid.blocks.every((b) => b.paragraph.isDeleted())

describe('paragraphCache', () => {
  it('lays a text out once and hands back the same layout while it is kept', () => {
    const cache = paragraphCache(2)
    const fonts = resources()
    const first = cache.layout(ck, text('a'), fonts)
    expect(cache.layout(ck, text('a'), fonts)).toBe(first)
    cache.delete()
  })

  it('lays a text out again when its wrap style changes', () => {
    const cache = paragraphCache(4)
    const fonts = resources()
    const auto = cache.layout(ck, text('a'), fonts)
    expect(cache.layout(ck, { ...text('a'), wrapStyle: 'balance' }, fonts)).not.toBe(auto)
    cache.delete()
  })

  it('lays a text out again when its curve changes', () => {
    const cache = paragraphCache(4)
    const fonts = resources()
    const straight = cache.layout(ck, text('a'), fonts)
    const arc = cache.layout(ck, { ...text('a'), curve: { shape: 'arcUp', amount: 50 } }, fonts)
    expect(arc).not.toBe(straight)
    expect(cache.layout(ck, { ...text('a'), curve: { shape: 'arcUp', amount: 60 } }, fonts)).not.toBe(arc)
    cache.delete()
  })

  it('frees the least recently used layout past the limit', () => {
    const cache = paragraphCache(2)
    const fonts = resources()
    const a = cache.layout(ck, text('a'), fonts)
    const b = cache.layout(ck, text('b'), fonts)
    cache.layout(ck, text('a'), fonts)
    const c = cache.layout(ck, text('c'), fonts)
    expect([freed(a), freed(b), freed(c)]).toEqual([false, true, false])
    expect(cache.layout(ck, text('a'), fonts)).toBe(a)
    expect(cache.layout(ck, text('c'), fonts)).toBe(c)
    expect(cache.layout(ck, text('b'), fonts)).not.toBe(b)
    expect(freed(a)).toBe(true)
    cache.delete()
  })

  it('frees every layout when the fonts change, and on delete', () => {
    const cache = paragraphCache(4)
    const before = cache.layout(ck, text('a'), resources())
    const after = cache.layout(ck, text('a'), resources())
    expect(freed(before)).toBe(true)
    cache.delete()
    expect(freed(after)).toBe(true)
  })
})

describe('textMeasure', () => {
  const shipped = resourceCache(ck).resources({
    fonts: loadFontFiles(),
    fallbackFamilies: [...FALLBACK_FAMILIES],
    images: {},
  })

  it('measures a curved text as the box round its placed letters, whatever width it is asked at', () => {
    const props = { ...text('Round the badge'), style: { ...text('').style, fontSize: 40 } }
    for (const curve of [
      { shape: 'circle', amount: 80 },
      { shape: 'wave', amount: 40 },
    ] as const) {
      const laid = layoutText(ck, { ...props, curve }, shipped)
      const bounds = laid.placed && placedBounds(laid.placed.runs)
      laid.delete()
      const size = { width: Math.ceil(bounds?.width ?? 0), height: Math.ceil(bounds?.height ?? 0) }
      const measure = textMeasure(ck, shipped)
      for (const width of [null, 50, 2000]) expect(measure({ ...props, curve }, width)).toEqual(size)
    }
  })
})
