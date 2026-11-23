import { describe, expect, it } from 'vitest'

import { scaleText } from '@dazbee/doc'
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

  it('raises a run’s glyphs raise / 100 × its own font size above the line’s baseline, the line’s height unchanged', () => {
    const plain = glyphs(textOf('$99c', []))
    const raised = glyphs(
      textOf('$99c', [
        { start: 0, end: 1, style: { raise: 30 } },
        { start: 3, end: 4, style: { raise: -20, fontSize: 20 } },
      ]),
    )
    const shift = (i: number) => (raised.glyphs[i]?.y ?? 0) - (plain.glyphs[i]?.y ?? 0)
    expect(shift(0)).toBeCloseTo(-12, 3)
    expect([shift(1), shift(2)]).toEqual([0, 0])
    expect(shift(3)).toBeCloseTo(4, 3)
    expect(raised.height).toBe(plain.height)
  })

  it('adds a raise to a superscript’s shift: a made-up one’s by its full size, and the font’s own glyph raised too', () => {
    const plain = glyphs(textOf('E x2', []))
    const madeUp = glyphs(textOf('E x2', [{ start: 2, end: 4, style: { features: { sups: true }, raise: 50 } }]))
    for (const [i, g] of madeUp.glyphs.slice(2).entries())
      expect(g.y - (plain.glyphs[i + 2]?.y ?? 0)).toBeCloseTo(-34, 0)
    expect(madeUp.height).toBe(plain.height)
    const own = glyphs(textOf('x2', sups(1, 2)))
    const ownRaised = glyphs(textOf('x2', [{ start: 1, end: 2, style: { features: { sups: true }, raise: 50 } }]))
    expect(ownRaised.glyphs[1]?.id).toBe(own.glyphs[1]?.id)
    expect((ownRaised.glyphs[1]?.y ?? 0) - (own.glyphs[1]?.y ?? 0)).toBeCloseTo(-20, 3)
  })

  it('gives the largest shift of any piece, raises included, as the most its glyphs move off their line', () => {
    const laid = layoutText(ck, textOf('$9', [{ start: 0, end: 1, style: { raise: -60 } }]), shipped)
    expect(laid.superSubShift).toBeCloseTo(24, 6)
    laid.delete()
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

  describe('a curved text', () => {
    /** A two-paragraph text that would wrap, set in a list, justified, shrunk to fit and cut to a line, curved. */
    const badge = (more: Record<string, unknown> = {}) =>
      TextProps.parse({
        x: 0,
        y: 0,
        width: 120,
        height: 40,
        text: 'Fresh and local produce\nEvery day',
        boxMode: 'fixed',
        align: 'justify',
        wrapStyle: 'balance',
        list: 'bullet',
        maxLines: 1,
        shrinkToFit: { min: 8, max: 40 },
        style: { fontFamily: 'Noto Sans', fontSize: 40, color: '#000000FF' },
        curve: { shape: 'arcUp', amount: 50 },
        ...more,
      })
    /** Each glyph's RSXform, the layout's size, its markers and each paragraph's lines. */
    const placedOf = (props: TextProps) => {
      const laid = layoutText(ck, props, shipped)
      const out = {
        xforms: (laid.placed?.runs ?? []).flatMap((r) => [...r.xforms]),
        width: laid.width,
        height: laid.height,
        markers: laid.blocks.filter((b) => b.marker).length,
        lineCounts: laid.blocks.map((b) => b.paragraph.getLineMetrics().length),
      }
      laid.delete()
      return out
    }

    it('sets each paragraph on one line, with no list, justify, shrink to fit or most lines, placed on its curve', () => {
      const curved = placedOf(badge())
      expect(curved.lineCounts).toEqual([1, 1])
      expect(curved.markers).toBe(0)
      expect(curved.xforms.length).toBe(4 * 'Fresh and local produceEvery day'.length)
      // At 40 px, unshrunk: its first line alone is wider than the box it was given.
      expect(curved.width).toBeGreaterThan(300)
      const straight = placedOf(badge({ curve: undefined }))
      expect(straight.xforms).toEqual([])
    })

    it('reads the same however its box is set: its size is its curve’s', () => {
      const fixed = placedOf(badge())
      for (const boxMode of ['autoWidth', 'autoHeight'])
        for (const width of [60, 900]) expect(placedOf(badge({ boxMode, width }))).toEqual(fixed)
    })

    it('doubles its box and its curve when its style is scaled by 2, as a corner drag scales it', () => {
      for (const shape of ['arcUp', 'arcDown', 'circle', 'wave']) {
        const props = badge({ curve: { shape, amount: 70 }, list: undefined })
        const once = placedOf(props)
        const twice = placedOf({ ...props, ...scaleText(props, 2) })
        expect(Math.abs(twice.width - 2 * once.width)).toBeLessThanOrEqual(2)
        expect(Math.abs(twice.height - 2 * once.height)).toBeLessThanOrEqual(2)
        // Every glyph is turned alike and sits twice as far from the box's corner, within 1 % of the
        // box: SkParagraph rounds each line's height, so a second line's curve is up to a pixel off.
        const near = 0.01 * Math.max(twice.width, twice.height)
        twice.xforms.forEach((v, i) => {
          const at = once.xforms[i] ?? 0
          if (i % 4 < 2) expect(v).toBeCloseTo(at, 1)
          else expect(Math.abs(v - 2 * at)).toBeLessThan(near)
        })
      }
    })
  })
})
