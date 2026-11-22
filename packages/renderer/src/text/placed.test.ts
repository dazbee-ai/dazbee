import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import type { Typeface } from '@dazbee/canvaskit'
import { FALLBACK_FAMILIES } from '@dazbee/fonts'
import { loadFontFiles } from '@dazbee/fonts/node'
import { framesOf, inOrder, parseDesign, shownGradient, type TextProps, withRunStyle } from '@dazbee/schema'

import { loadCanvasKit } from '../node.ts'
import { resourceCache } from '../resources.ts'
import { render, type SceneLayer } from '../scene.ts'
import { textMeasure } from './cache.ts'
import { layoutText } from './layout.ts'
import { inPlace, placeLetters } from './placed.ts'
import { passPaint, type TextPass } from './text-paint.ts'

const ck = await loadCanvasKit()
const resources = resourceCache(ck).resources({
  fonts: loadFontFiles(),
  fallbackFamilies: [...FALLBACK_FAMILIES],
  images: {},
})
const FIXTURES = join(import.meta.dirname, '..', '..', '..', '..', 'tests', 'pixels', 'fixtures')
const PASSES: TextPass[] = [{ kind: 'fill' }, { kind: 'outline', under: false }, { kind: 'outline', under: true }]
const BOX = { x: 0, y: 0, width: 400, height: 200 }

/** Every text of the text paint and text styles fixtures, in English, Hindi and Arabic. */
const texts = ['text-paint', 'text-styles'].flatMap((name) => {
  const parsed = parseDesign(JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), 'utf8')))
  if (!parsed.success) throw new Error(parsed.errors.join('\n'))
  const { design } = parsed
  const textsOf = (layers: readonly SceneLayer[]): SceneLayer[] =>
    layers.flatMap((l) => [...(l.type === 'text' ? [l] : []), ...textsOf(l.children)])
  return inOrder(design.pages).flatMap(([pageId]) =>
    framesOf(design, pageId).flatMap(([frameId]) =>
      textsOf(render(design, frameId, undefined, textMeasure(ck, resources)).layers).map((layer) => ({
        label: `${name} ${frameId} ${layer.id}`,
        props: layer.props as TextProps,
      })),
    ),
  )
})

/** The style the character at `offset` of a text is set in: its base style, with each run over it, later ones winning. */
const styleAt = (props: TextProps, offset: number) =>
  props.runs.reduce(
    (style, run) => (run.start <= offset && offset < run.end ? withRunStyle(style, run.style) : style),
    props.style,
  )

/** For each UTF-8 offset into `text`, the UTF-16 offset of the character it falls in. */
const unitsOf = (text: string) =>
  [...text].flatMap((ch, i, all) => {
    const unit = all.slice(0, i).join('').length
    return Array.from({ length: new TextEncoder().encode(ch).length }, () => unit)
  })

/** What a paint draws with: whether there is one, its colour, its stroke and whether it has a shader. */
const paintOf = (style: TextProps['style'], pass: TextPass) => {
  const paint = passPaint(ck, style, pass, BOX)
  const drawn = paint && {
    color: [...paint.getColor()].map((c) => Math.round(c * 255)),
    stroke: paint.getStrokeWidth(),
    gradient: shownGradient(style),
  }
  paint?.delete()
  return drawn
}

describe('placeLetters', () => {
  it('reads texts of the fixtures in each script', () => {
    expect(texts.length).toBeGreaterThan(60)
    const families = new Set(texts.map((t) => t.props.style.fontFamily))
    expect(families).toEqual(new Set(['Noto Sans', 'Noto Sans Devanagari', 'Noto Naskh Arabic']))
  })

  it.each(texts)(
    '$label: placed in place, it has its paragraphs’ glyphs, typefaces and positions, each run in its piece’s paint',
    ({ props }) => {
      const laid = layoutText(ck, props, resources)
      laid.placed = placeLetters(ck, laid, inPlace)
      const expected: { block: number; glyph: number; x: number; y: number; typeface: Typeface; offset: number }[] = []
      for (const [block, b] of laid.blocks.entries()) {
        const units = unitsOf(b.text)
        const seen = new Set<string>()
        for (const line of b.paragraph.getShapedLines())
          for (const run of line.runs)
            run.glyphs.forEach((glyph, i) => {
              const x = b.x + (run.positions[2 * i] ?? 0)
              const y = laid.dy + b.y + (run.positions[2 * i + 1] ?? 0)
              // A glyph drawn twice in one place, clipped, where a style starts inside it, is placed once.
              if (seen.has(`${glyph} ${x} ${y}`)) return
              seen.add(`${glyph} ${x} ${y}`)
              const unit = units[run.offsets[i] ?? 0] ?? b.text.length
              const offset = b.start + Math.min(unit, b.text.length - 1)
              expected.push({ block, glyph, x, y, typeface: run.typeface, offset })
            })
      }
      const actual = laid.placed.runs.flatMap((run) =>
        [...run.glyphs].map((glyph, i) => ({ run, glyph, xform: [...run.xforms.subarray(4 * i, 4 * i + 4)] })),
      )
      expect(actual.map((a) => [a.run.block, a.glyph])).toEqual(expected.map((e) => [e.block, e.glyph]))
      actual.forEach(({ run, xform }, i) => {
        const e = expected[i]
        if (!e) throw new Error('a glyph too many')
        expect(xform[0]).toBe(1)
        expect(xform[1]).toBe(0)
        expect(xform[2]).toBeCloseTo(e.x, 3)
        expect(xform[3]).toBeCloseTo(e.y, 3)
        const typeface = run.font.getTypeface()
        expect(typeface?.isAliasOf(e.typeface), `glyph ${i}'s typeface`).toBe(true)
        typeface?.delete()
        for (const pass of PASSES) expect(paintOf(run.style, pass)).toEqual(paintOf(styleAt(props, e.offset), pass))
      })
      for (const typeface of new Set(expected.map((e) => e.typeface))) typeface.delete()
      laid.delete()
    },
  )

  it('gives a font slanted and emboldened where SkParagraph makes them up', () => {
    const props = { ...(texts[0]?.props as TextProps), text: 'مرحبا', runs: [], list: undefined }
    const laid = layoutText(
      ck,
      { ...props, style: { ...props.style, fontFamily: 'Noto Naskh Arabic', fontWeight: 900, fontStyle: 'italic' } },
      resources,
    )
    laid.placed = placeLetters(ck, laid, inPlace)
    const fonts = laid.placed.runs.map((r) => [r.font.isEmbolden(), r.font.getSkewX()])
    laid.delete()
    expect(fonts.length).toBeGreaterThan(0)
    for (const font of fonts) expect(font).toEqual([true, -0.25])
  })

  it('turns each glyph’s box, its advance by its line’s height, with the glyph', () => {
    const props = { ...(texts[0]?.props as TextProps), text: 'HI', runs: [], list: undefined }
    const laid = layoutText(ck, props, resources)
    const quarter = placeLetters(ck, laid, (line, along, _advance, offset) => [0, 1, along, line.baseline + offset])
    const straight = placeLetters(ck, laid, inPlace)
    const [turned, flat] = [quarter.runs[0], straight.runs[0]]
    if (!turned || !flat) throw new Error('no runs')
    const metrics = laid.blocks[0]?.paragraph.getLineMetrics()[0]
    const [ox = 0, oy = 0] = [flat.xforms[2], flat.xforms[3]]
    const advance = flat.advances[0] ?? 0
    // Straight, its top left is the line's ascent above its origin; turned a quarter clockwise, the
    // box's top edge runs down from the line's ascent right of the origin.
    expect([...flat.boxes.subarray(0, 4)].map((v) => +v.toFixed(3))).toEqual(
      [ox, oy - (metrics?.ascent ?? 0), ox + advance, oy - (metrics?.ascent ?? 0)].map((v) => +v.toFixed(3)),
    )
    expect([...turned.boxes.subarray(0, 4)].map((v) => +v.toFixed(3))).toEqual(
      [ox + (metrics?.ascent ?? 0), oy, ox + (metrics?.ascent ?? 0), oy + advance].map((v) => +v.toFixed(3)),
    )
    expect(advance).toBeGreaterThan(10)
    quarter.delete()
    straight.delete()
    laid.delete()
  })
})
