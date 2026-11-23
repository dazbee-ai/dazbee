// A text's 3D sides in PDF and SVG exports: one path, in a chosen colour or a darker shade of the
// letters' colour, with straight letters kept as text in a PDF and curved or bounced ones drawn as
// shapes.
import { inflateSync } from 'node:zlib'

import { afterAll, describe, expect, it } from 'vitest'

import { renderVector, resourceCache, shadedColour } from '@dazbee/renderer'
import { loadCanvasKit } from '@dazbee/renderer/node'

import { loadFixtures } from './fixtures.ts'
import { fixtureResources } from './pixels.ts'
import { pdfText, startPdfium } from './vector.ts'

const ck = await loadCanvasKit()
const bytes = fixtureResources()
const cache = resourceCache(ck)
const pdfium = await startPdfium(afterAll)
afterAll(() => cache.delete())

/** A frame holding one heavy "SALE" with 3D sides, `extrusion` as given. */
const saleWith = (extrusion: Record<string, unknown>) => ({
  meta: { designId: 'd', name: '3D' },
  pages: { p: { name: 'Page', order: 'a0' } },
  frames: { f: { pageId: 'p', name: 'F', width: 400, height: 200, x: 0, y: 0, order: 'a0' } },
  nodes: {
    sale: {
      type: 'text',
      parentId: 'f',
      link: 'sale',
      index: 'a0',
      name: 'sale',
      props: {
        x: 20,
        y: 20,
        width: 300,
        height: 140,
        boxMode: 'autoWidth',
        text: 'SALE',
        style: { fontFamily: 'Noto Sans', fontWeight: 800, fontSize: 80, color: '#E53935FF' },
        extrusion,
      },
    },
  },
})

/**
 * How many paths a one-page PDF fills, read from its compressed streams as Skia writes them; a
 * stream that isn't compressed holds no drawing.
 */
function filledPaths(pdf: Uint8Array): number {
  const file = new TextDecoder('latin1').decode(pdf)
  let fills = 0
  for (const found of file.matchAll(/stream\r?\n/g)) {
    const start = (found.index ?? 0) + found[0].length
    const content = inflated(pdf.subarray(start, file.indexOf('endstream', start)))
    fills += content.split(/\s+/).filter((operator) => operator === 'f' || operator === 'f*').length
  }
  return fills
}

/** A Flate stream's contents, or nothing for a stream that isn't one. */
function inflated(stream: Uint8Array): string {
  try {
    return inflateSync(stream).toString('latin1')
  } catch {
    return ''
  }
}

/** The `<path` elements of an SVG, without their outlines. */
function svgPaths(svg: Uint8Array): string[] {
  return [...new TextDecoder().decode(svg).matchAll(/<path[^>]*>/g)].map((m) => m[0].replace(/ d="[^"]*"/, ''))
}

describe('a text’s 3D sides in PDF and SVG', () => {
  it('are one path in a chosen colour, the letters kept as text in a PDF', async () => {
    const design = saleWith({ depth: 20, angle: 45, color: '#5D4037FF' })
    const pdf = renderVector(ck, design, 'f', bytes, 'pdf', cache)
    expect(filledPaths(pdf)).toBe(1)
    expect(await pdfText(pdfium, pdf)).toContain('SALE')
    const paths = svgPaths(renderVector(ck, design, 'f', bytes, 'svg', cache))
    expect(paths.filter((path) => path.includes('fill="#5D4037"'))).toHaveLength(1)
    expect(paths).toHaveLength(2)
  })

  it('are one path in a darker shade of the letters’ colour, black at 35 % laid over it', async () => {
    const design = saleWith({ depth: 20, angle: 45 })
    const pdf = renderVector(ck, design, 'f', bytes, 'pdf', cache)
    expect(filledPaths(pdf)).toBe(1)
    expect(await pdfText(pdfium, pdf)).toContain('SALE')
    const paths = svgPaths(renderVector(ck, design, 'f', bytes, 'svg', cache))
    const shade = shadedColour('#E53935FF').slice(0, 7)
    expect(shade).toBe('#952523')
    expect(paths.filter((path) => path.includes(`fill="${shade}"`))).toHaveLength(1)
    expect(paths).toHaveLength(2)
  })

  it('keep the fixture’s straight letters as text in a PDF, and draw its curved and bounced letters as shapes', async () => {
    const effects = loadFixtures().find((f) => f.name === 'text-effects')
    if (!effects) throw new Error('fixture missing')
    const text = await pdfText(pdfium, renderVector(ck, effects.json, 'extrusion', bytes, 'pdf', cache))
    expect(text.match(/SALE/g)).toHaveLength(1)
    expect(text).toContain('HOT DEAL')
    expect(text).not.toContain('SUMMER')
    expect(text).not.toContain('PARTY')
  })
})
