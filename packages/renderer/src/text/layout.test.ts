import { describe, expect, it } from 'vitest'

import { FALLBACK_FAMILIES } from '@dazbee/fonts'
import { loadFontFiles } from '@dazbee/fonts/node'
import { TextProps } from '@dazbee/schema'

import { loadCanvasKit } from '../node.ts'
import { resourceCache } from '../resources.ts'
import { layoutText } from './layout.ts'

const ck = await loadCanvasKit()

describe('layoutText', () => {
  const shipped = resourceCache(ck).resources({
    fonts: loadFontFiles(),
    fallbackFamilies: [...FALLBACK_FAMILIES],
    images: {},
  })
  /** A text on one line at 40 px, its runs as given. */
  const textOf = (value: string, runs: object[], family = 'Noto Sans') =>
    TextProps.parse({
      x: 0,
      y: 0,
      width: 2000,
      height: 100,
      text: value,
      runs,
      style: { fontFamily: family, fontSize: 40, color: '#000000FF' },
    })
  /** Each glyph drawn: its id, its run's size, and its baseline. */
  const glyphs = (props: TextProps) => {
    const laid = layoutText(ck, props, shipped)
    const out = (laid.blocks[0]?.paragraph.getShapedLines() ?? []).flatMap((line) =>
      line.runs.flatMap((run) =>
        [...run.glyphs].map((id, i) => ({ id, size: run.size, y: run.positions[i * 2 + 1] ?? 0 })),
      ),
    )
    const height = laid.height
    laid.delete()
    return { glyphs: out, height }
  }
  const sups = (start: number, end: number) => [{ start, end, style: { features: { sups: true } } }]
  const subs = (start: number, end: number) => [{ start, end, style: { features: { subs: true } } }]

  it('draws a superscript in the font’s own glyph where it has one for every letter and digit, at the full size', () => {
    const plain = glyphs(textOf('x2', []))
    const raised = glyphs(textOf('x2', sups(1, 2)))
    expect(raised.glyphs[1]?.id).not.toBe(plain.glyphs[1]?.id)
    expect(raised.glyphs[1]?.size).toBe(40)
    expect(raised.glyphs[1]?.y).toBe(plain.glyphs[1]?.y)
  })

  it('makes up a superscript whole where a letter lacks its glyph: the standard glyphs at 60 %, raised 35 % of an em', () => {
    const plain = glyphs(textOf('E x2', []))
    const raised = glyphs(textOf('E x2', sups(2, 4)))
    expect(raised.glyphs.slice(2).map((g) => [g.id, g.size])).toEqual(plain.glyphs.slice(2).map((g) => [g.id, 24]))
    for (const [i, g] of raised.glyphs.slice(2).entries())
      expect(g.y - (plain.glyphs[i + 2]?.y ?? 0)).toBeCloseTo(-14, 0)
    expect(raised.glyphs[0]?.y).toBe(plain.glyphs[0]?.y)
    expect(raised.height).toBe(plain.height)
  })

  it('makes up a subscript in a font that has none, lowered by its offset of 7.5 % of an em', () => {
    const plain = glyphs(textOf('مرحبا', [], 'Noto Naskh Arabic'))
    const lowered = glyphs(textOf('مرحبا', subs(0, 5), 'Noto Naskh Arabic'))
    expect(lowered.glyphs.map((g) => g.size)).toEqual(plain.glyphs.map(() => 24))
    expect((lowered.glyphs[0]?.y ?? 0) - (plain.glyphs[0]?.y ?? 0)).toBeCloseTo(3, 0)
    expect(lowered.height).toBe(plain.height)
  })

  it('keeps the full size’s line for a paragraph that is all made-up superscript', () => {
    const plain = glyphs(textOf('ab\nE', []))
    const raised = glyphs(textOf('ab\nE', sups(0, 2)))
    expect(raised.glyphs.map((g) => g.size)).toEqual([24, 24])
    expect(raised.height).toBe(plain.height)
  })

  it('draws a list’s number as it is, though its paragraph is superscript in a font with superscript digits', () => {
    const marker = (props: TextProps) => {
      const laid = layoutText(ck, { ...props, list: 'number' }, shipped)
      const ids = (laid.blocks[0]?.marker?.getShapedLines() ?? []).flatMap((l) => l.runs.flatMap((r) => [...r.glyphs]))
      laid.delete()
      return ids
    }
    expect(marker(textOf('12', sups(0, 2)))).toEqual(marker(textOf('12', [])))
  })

  it('never breaks a word balancing lines whose longest word is a fraction of a pixel wide', () => {
    // At every size the longest word fits the box and sets the narrowest width, most a fraction of a pixel wide.
    const broken = []
    for (let size = 60; size <= 110; size++) {
      const props = TextProps.parse({
        x: 0,
        y: 0,
        width: 400,
        height: 100,
        text: 'The Stride Air is here',
        wrapStyle: 'balance',
        style: { fontFamily: 'Noto Sans', fontWeight: 800, fontSize: size, color: '#000000FF', textCase: 'upper' },
      })
      const laid = layoutText(ck, props, shipped)
      const starts = (laid.blocks[0]?.paragraph.getLineMetrics() ?? []).map((line) => line.startIndex)
      laid.delete()
      if (starts.some((start) => start > 0 && props.text[start - 1] !== ' ')) broken.push(size)
    }
    expect(broken).toEqual([])
  })
})
