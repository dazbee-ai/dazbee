// Text drawn letter by letter (ADR-0021): every text of the text paint and text styles fixtures,
// placed with each letter left where its paragraph draws it, draws close to its paragraph on the CPU
// surface, made-up bold and italic included, the same twice over; and into a PDF and an SVG its
// letters go as shapes, drawn as the CPU draws them, overlaps included.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

import { renderDesign, renderVector, type ResourceCache } from '@dazbee/renderer'
import { loadCanvasKit } from '@dazbee/renderer/node'
import { framesOf, inOrder, parseDesign } from '@dazbee/schema'

import { loadFixtures } from './fixtures.ts'
import { ASSETS_DIR, comparePixels, decodePng, fixtureResources, type Pixels, REFERENCE_DIR } from './pixels.ts'
import { placing } from './test-placing.ts'
import {
  overWhite,
  pdfText,
  rasterisePdf,
  rasteriseSvg,
  readVectorBaselines,
  startPdfium,
  vectorDifference,
} from './vector.ts'

const ck = await loadCanvasKit()
const bytes = fixtureResources()
const pdfium = await startPdfium(afterAll)
const baselines = readVectorBaselines()

/** The share of pixels, in percent, that differ between two images. */
const share = (a: Pixels, b: Pixels) => (100 * comparePixels(a, b).differing) / (a.width * a.height)

/** Red at the box's left edge to blue at its right. */
const SWEEP = {
  type: 'linear',
  from: { x: 0, y: 0.5 },
  to: { x: 1, y: 0.5 },
  stops: [
    { offset: 0, color: '#FF0000FF' },
    { offset: 1, color: '#0000FFFF' },
  ],
}

/**
 * The middle row of each band of rows where the lines drawn over a text differ from it along most of
 * its width, `lined` against `bare`: where its underline and strikethrough are.
 */
function lineRows(bare: Pixels, lined: Pixels): number[] {
  const rows: number[] = []
  for (let y = 0; y < bare.height; y++) {
    let differing = 0
    for (let x = 0; x < bare.width; x++) {
      const i = (y * bare.width + x) * 4
      if ([0, 1, 2].some((c) => bare.pixels[i + c] !== lined.pixels[i + c])) differing++
    }
    if (differing > 250) rows.push(y)
  }
  const bands: number[][] = []
  for (const y of rows) {
    const band = bands.at(-1)
    if (band && band.at(-1) === y - 1) band.push(y)
    else bands.push([y])
  }
  return bands.map((band) => ((band[0] ?? 0) + (band.at(-1) ?? 0)) / 2)
}

/** A 640 by 160 frame on white holding one text in the style given. */
function oneText(text: string, style: Record<string, unknown>) {
  return {
    meta: { designId: 'one-text', name: 'One text' },
    pages: { p1: { name: 'Page 1', order: 'a0' } },
    frames: {
      f: {
        pageId: 'p1',
        name: 'Frame',
        width: 640,
        height: 160,
        x: 0,
        y: 0,
        fills: [{ type: 'solid', color: '#FFFFFFFF' }],
        order: 'a0',
      },
    },
    nodes: {
      t: {
        type: 'text',
        parentId: 'f',
        link: 't',
        index: 'a0',
        name: 'Words',
        props: {
          x: 20,
          y: 20,
          width: 600,
          height: 120,
          boxMode: 'fixed',
          text,
          style: { color: '#15121AFF', ...style },
        },
      },
    },
  }
}

const frames = loadFixtures()
  .filter(({ name }) => ['text-paint', 'text-styles'].includes(name))
  .flatMap(({ name, json }) => {
    const parsed = parseDesign(json)
    if (!parsed.success) throw new Error(parsed.errors.join('\n'))
    const { design } = parsed
    return inOrder(design.pages).flatMap(([pageId]) =>
      framesOf(design, pageId).map(([frameId]) => ({ name, json, frameId })),
    )
  })

describe('placed text', () => {
  it.each(frames)(
    '$name $frameId draws within 0.5 % of the pixels of its reference, the same each time',
    ({ name, json, frameId }) => {
      const cache = placing(ck)
      const placed = renderDesign(ck, json, frameId, bytes, cache)
      const again = renderDesign(ck, json, frameId, bytes, cache)
      cache.delete()
      const reference = decodePng(ck, new Uint8Array(readFileSync(join(REFERENCE_DIR, name, `${frameId}.png`))))
      expect(comparePixels(placed, again).differing).toBe(0)
      expect(share(reference, placed)).toBeLessThan(0.5)
    },
  )

  it('draws an italic and a weight its family has no face for slanted and emboldened, as its paragraph does', () => {
    const anton = {
      family: 'Anton',
      bytes: new Uint8Array(readFileSync(join(ASSETS_DIR, 'fonts', 'Anton-Regular.ttf'))),
    }
    const withAnton = { ...bytes, fonts: [...bytes.fonts, anton] }
    const style = { fontFamily: 'Anton', fontSize: 96 }
    const faux = oneText('Faux style', { ...style, fontWeight: 900, fontStyle: 'italic' })
    const cache = placing(ck)
    const placed = renderDesign(ck, faux, 'f', withAnton, cache)
    cache.delete()
    const paragraph = renderDesign(ck, faux, 'f', withAnton)
    const upright = renderDesign(ck, oneText('Faux style', style), 'f', withAnton)
    const lowered = placing(ck, (line, along, _advance, offset) => [1, 0, along, line.baseline + offset + 4])
    const moved = renderDesign(ck, faux, 'f', withAnton, lowered)
    lowered.delete()
    // Placed glyphs a few pixels lower differ from the paragraph, so the placement is what draws them.
    expect(share(paragraph, moved)).toBeGreaterThan(1)
    expect(share(paragraph, upright)).toBeGreaterThan(5)
    expect(share(paragraph, placed)).toBeLessThan(1)
  })

  it.each([
    ['in its colour', { color: '#C0182BFF' }],
    ['in its gradient', { gradient: SWEEP }],
  ])('underlines and strikes through a letter at a time %s, where its paragraph draws its lines', (_, paint) => {
    const lined = { fontFamily: 'Noto Sans', fontSize: 64, underline: true, strikethrough: true, ...paint }
    const unlined = { ...lined, underline: false, strikethrough: false }
    const draw = (style: Record<string, unknown>, cache?: ResourceCache) =>
      renderDesign(ck, oneText('Lines under', style), 'f', bytes, cache)
    const cache = placing(ck)
    const placed = lineRows(draw(unlined, cache), draw(lined, cache))
    cache.delete()
    const paragraph = lineRows(draw(unlined), draw(lined))
    // SkParagraph puts its lines off its unrounded baseline, its glyphs on the rounded one; placed
    // lines go with the glyphs, so within a pixel.
    expect(placed).toHaveLength(2)
    expect(paragraph).toHaveLength(2)
    placed.forEach((row, i) => expect(Math.abs(row - (paragraph[i] ?? 0))).toBeLessThanOrEqual(1))
  })
})

describe('placed letters in a PDF and an SVG', () => {
  it.each(frames)(
    '$name $frameId: placed letters reach the PDF and SVG as shapes, drawn as the CPU draws them',
    async ({ name, json, frameId }) => {
      const placed = placing(ck)
      const cpu = overWhite(renderDesign(ck, json, frameId, bytes, placed))
      const pdf = renderVector(ck, json, frameId, bytes, 'pdf', placed)
      const svg = renderVector(ck, json, frameId, bytes, 'svg', placed)
      placed.delete()
      // Only the list markers, drawn as they are laid out, stay text: bullets, and numbers and their full stops.
      const text = (await pdfText(pdfium, pdf)).replaceAll(/\s/gu, '')
      expect(text.replaceAll(/[•.]|(?<!\d)[1-9](?!\d)/gu, '')).toBe('')
      expect(new TextDecoder().decode(svg)).not.toContain('<text')
      const baseline = baselines[`${name} ${frameId}`]
      if (!baseline) throw new Error(`no vector baseline for ${name} ${frameId}`)
      expect(vectorDifference(cpu, await rasterisePdf(pdfium, pdf)), 'pdf').toBeLessThanOrEqual(baseline.pdf.limit)
      expect(vectorDifference(cpu, rasteriseSvg(svg)), 'svg').toBeLessThanOrEqual(baseline.svg.limit)
    },
  )

  it('darkens where see-through placed letters overlap, in a PDF and an SVG as on the CPU surface', async () => {
    const json = {
      meta: { designId: 'overlap', name: 'Overlap' },
      pages: { p: { name: 'Page', order: 'a0' } },
      frames: { f: { pageId: 'p', name: 'F', width: 400, height: 160, x: 0, y: 0, order: 'a0' } },
      nodes: {
        t: {
          type: 'text',
          parentId: 'f',
          link: 't',
          index: 'a0',
          name: 'Letters',
          props: {
            x: 20,
            y: 20,
            width: 360,
            height: 120,
            boxMode: 'fixed',
            text: 'OOOO',
            style: { fontFamily: 'Noto Sans', fontSize: 96, fontWeight: 800, color: '#0000FF80' },
          },
        },
      },
    }
    // Each letter at half its distance along the line and turned 20°, so neighbours overlap.
    const turn = (20 * Math.PI) / 180
    const placed = placing(ck, (line, along, _advance, offset) => [
      Math.cos(turn),
      Math.sin(turn),
      line.left + (along - line.left) / 2,
      line.baseline + offset,
    ])
    const cpu = overWhite(renderDesign(ck, json, 'f', bytes, placed))
    const pdf = await rasterisePdf(pdfium, renderVector(ck, json, 'f', bytes, 'pdf', placed))
    const svg = rasteriseSvg(renderVector(ck, json, 'f', bytes, 'svg', placed))
    placed.delete()
    // Half-clear blue over white is (127, 127, 255) once and (63, 63, 255) where two letters cover it.
    const twice = ({ pixels }: Pixels) => pixels.filter((v, i) => i % 4 === 0 && v < 90).length
    expect(twice(cpu)).toBeGreaterThan(500)
    for (const [type, drawn] of [
      ['pdf', pdf],
      ['svg', svg],
    ] as const)
      expect(Math.abs(twice(drawn) / twice(cpu) - 1), type).toBeLessThan(0.1)
  })
})
