import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

import type { Canvas, Font, Path, PDFDocument, SkPicture, TextBlob } from '@dazbee/canvaskit'
import { exportDesign } from '@dazbee/export'
import { loadFontFiles } from '@dazbee/fonts/node'
import { emojiTestFont } from '@dazbee/fonts/test-fonts'
import { layoutText, render, renderVector, resourceCache, type SceneLayer, textMeasure } from '@dazbee/renderer'
import { loadCanvasKit } from '@dazbee/renderer/node'
import { framesOf, inOrder, parseDesign } from '@dazbee/schema'

import { loadFixtures } from './fixtures.ts'
import { pdfGlyphs } from './pdf-glyphs.ts'
import { cpuRender, encodePng, fixtureResources, OUTPUT_DIR, type Pixels } from './pixels.ts'
import {
  overWhite,
  pdfText,
  rasterisePdf,
  rasteriseSvg,
  readVectorBaselines,
  recordVectorBaseline,
  startPdfium,
  VECTOR_TYPES,
  vectorDifference,
  type VectorType,
} from './vector.ts'

type Affine = [number, number, number, number, number, number]

/** Set to record the baselines from the current exports, after checking them by eye. */
const UPDATE = process.env.UPDATE_VECTOR_BASELINES === '1'
if (UPDATE && process.env.CI) throw new Error('UPDATE_VECTOR_BASELINES rewrites the baselines, so CI must never set it')

const ck = await loadCanvasKit()
const bytes = fixtureResources()
const cache = resourceCache(ck)
const pdfium = await startPdfium(afterAll)
afterAll(() => cache.delete())

const cases = loadFixtures().flatMap(({ name, json }) => {
  const parsed = parseDesign(json)
  if (!parsed.success) throw new Error(parsed.errors.join('\n'))
  const design = parsed.design
  return inOrder(design.pages).flatMap(([pageId]) =>
    framesOf(design, pageId).map(([frameId]) => ({ name, json, design, frameId, label: `${name} ${frameId}` })),
  )
})
const baselines = readVectorBaselines()
/** What draws each type of file in the check. */
const RASTERISERS = { pdf: 'pdfium', svg: 'resvg' } as const satisfies Record<VectorType, string>
const checks = cases.flatMap((c) =>
  VECTOR_TYPES.map((type) => ({ ...c, type, by: RASTERISERS[type], format: type.toUpperCase() })),
)
/** Each case's PDF, made once for the pixel check and read again for the glyph check. */
const pdfs = new Map<string, Uint8Array>()
/** Lets the test worker answer vitest between long draws, which otherwise time its messages out. */
const breathe = () => new Promise((resolve) => setImmediate(resolve))

const apply = ([a, b, c, d, e, f]: Affine, x: number, y: number) => [a * x + c * y + e, b * x + d * y + f] as const
const turn = (m: Affine, degrees: number, cx: number, cy: number): Affine => {
  if (degrees === 0) return m
  const r = (degrees * Math.PI) / 180
  const [cos, sin] = [Math.cos(r), Math.sin(r)]
  // m × (translate(c) · rotate · translate(-c))
  const [a, b, c, d, e, f] = m
  const tx = cx - cos * cx + sin * cy
  const ty = cy - sin * cx - cos * cy
  return [
    a * cos + c * sin,
    b * cos + d * sin,
    -a * sin + c * cos,
    -b * sin + d * cos,
    a * tx + c * ty + e,
    b * tx + d * ty + f,
  ]
}

/** `m` × the mirror of a box across its centre lines that `flipX` and `flipY` name. */
const flip = (
  m: Affine,
  box: {
    x: number
    y: number
    width: number
    height: number
    flipX?: boolean | undefined
    flipY?: boolean | undefined
  },
): Affine => {
  const [a, b, c, d, e, f] = m
  const sx = box.flipX ? -1 : 1
  const sy = box.flipY ? -1 : 1
  const tx = box.flipX ? 2 * box.x + box.width : 0
  const ty = box.flipY ? 2 * box.y + box.height : 0
  return [a * sx, b * sx, c * sy, d * sy, a * tx + c * ty + e, b * tx + d * ty + f]
}

/** The CPU render `cpuOf` made last, with its case's label. */
let lastCpu: { label: string; pixels: Pixels } | undefined

/** A case's CPU render over white, kept for its other check, which comes next. */
function cpuOf(c: (typeof cases)[number]): Pixels {
  if (lastCpu?.label !== c.label) lastCpu = { label: c.label, pixels: overWhite(cpuRender(ck, c, bytes, cache)) }
  return lastCpu.pixels
}

/**
 * Every glyph the renderer lays out, by glyph id, where it draws it in the frame, each layer turned
 * as it is drawn and a text mirrored as it is flipped.
 */
function rendererGlyphs(
  layers: readonly SceneLayer[],
  resources: ReturnType<typeof cache.resources>,
  m: Affine = [1, 0, 0, 1, 0, 0],
  into = new Map<number, [number, number][]>(),
) {
  for (const layer of layers) {
    const { props } = layer
    const turned = turn(m, props.rotation, props.x + props.width / 2, props.y + props.height / 2)
    if (layer.type === 'text') {
      const drawn = flip(turned, layer.props)
      const laid = layoutText(ck, layer.props, resources)
      for (const b of laid.blocks) {
        const pieces: [typeof b.paragraph | null, number, number][] = [
          [b.paragraph, b.x, b.y],
          [b.marker, b.markerX, b.y + b.markerY],
        ]
        for (const [paragraph, ox, oy] of pieces) {
          for (const line of paragraph?.getShapedLines() ?? []) {
            for (const run of line.runs) {
              run.glyphs.forEach((glyph, i) => {
                const at = apply(
                  drawn,
                  props.x + ox + (run.positions[2 * i] ?? 0),
                  props.y + laid.dy + oy + (run.positions[2 * i + 1] ?? 0),
                )
                into.set(glyph, [...(into.get(glyph) ?? []), [at[0], at[1]]])
              })
            }
          }
        }
      }
      laid.delete()
    }
    rendererGlyphs(layer.children, resources, turned, into)
  }
  return into
}

describe('PDF and SVG exports (#56)', () => {
  it.each(checks)('$label: $by draws the $format as the CPU does, within the baseline', async (check) => {
    const { name, json, frameId, label, type } = check
    const cpu = cpuOf(check)
    await breathe()
    const file = renderVector(ck, json, frameId, bytes, type, cache)
    if (type === 'pdf') pdfs.set(label, file)
    await breathe()
    const drawn = type === 'pdf' ? await rasterisePdf(pdfium, file) : rasteriseSvg(file)
    await breathe()
    const measured = vectorDifference(cpu, drawn)
    if (UPDATE) {
      recordVectorBaseline(label, type, measured)
      return
    }
    const baseline = baselines[label]?.[type]
    if (!baseline)
      throw new Error(
        `no ${type} vector baseline for ${label}; record one with UPDATE_VECTOR_BASELINES=1 and commit it`,
      )
    if (measured > baseline.limit) {
      const out = join(OUTPUT_DIR, 'vector', name)
      mkdirSync(out, { recursive: true })
      writeFileSync(join(out, `${frameId}.${type}`), file)
      writeFileSync(join(out, `${frameId}.cpu.png`), encodePng(ck, cpu))
      writeFileSync(join(out, `${frameId}.${type}.png`), encodePng(ck, drawn))
    }
    expect(measured, `${type}: % of pixels differing (baseline ${baseline.percent}%)`).toBeLessThanOrEqual(
      baseline.limit,
    )
  })

  it('keeps PDF text as text, each text once, outlines included', async () => {
    const styles = cases.find((c) => c.name === 'text-styles')
    const sale = cases.find((c) => c.name === 'english-sale-ad')
    if (!styles || !sale) throw new Error('fixtures missing')
    const stylesText = await pdfText(pdfium, renderVector(ck, styles.json, styles.frameId, bytes, 'pdf', cache))
    expect(stylesText).toContain('Bold outline')
    expect(stylesText.match(/Bold/g)).toHaveLength(1)
    expect(await pdfText(pdfium, renderVector(ck, sale.json, sale.frameId, bytes, 'pdf', cache))).toContain(
      'Summer sale',
    )
  })

  it.each(cases.filter((c) => c.name === 'text-effects'))(
    '$label: draws curved letters into a PDF and an SVG as shapes, never as text',
    async ({ json, frameId, label }) => {
      const pdf = pdfs.get(label) ?? renderVector(ck, json, frameId, bytes, 'pdf', cache)
      expect((await pdfText(pdfium, pdf)).trim()).toBe('')
      const svg = new TextDecoder().decode(renderVector(ck, json, frameId, bytes, 'svg', cache))
      expect(svg).not.toContain('<text')
      expect(svg).toContain('<path')
    },
  )

  it('draws small caps in a PDF from the font that has them, as the screen does', async () => {
    const text = (id: string, family: string) => ({
      type: 'text',
      parentId: 'f',
      link: id,
      index: id === 'own' ? 'a0' : 'a1',
      name: id,
      props: {
        x: 10,
        y: id === 'own' ? 10 : 80,
        width: 300,
        height: 60,
        text: 'Sale',
        style: { fontFamily: family, fontSize: 40, color: '#000000FF', features: { smcp: true } },
      },
    })
    const json = {
      meta: { designId: 'd', name: 'Small caps' },
      pages: { p: { name: 'Page', order: 'a0' } },
      frames: { f: { pageId: 'p', name: 'F', width: 320, height: 160, x: 0, y: 0, order: 'a0' } },
      nodes: { own: text('own', 'Noto Sans'), madeUp: text('madeUp', 'Noto Sans Devanagari') },
    }
    // Noto Sans has small caps, glyphs of their own; Noto Sans Devanagari has none, so they are made-up capitals.
    const inFile = await pdfText(pdfium, renderVector(ck, json, 'f', bytes, 'pdf', cache))
    const [own, madeUp] = inFile.split(/\r?\n/)
    expect(own?.startsWith('S')).toBe(true)
    expect(own).not.toBe('SALE')
    expect(madeUp).toBe('SALE')
  })

  it.each(cases)(
    '$label: every glyph in the PDF sits where the renderer draws it, within 0.05 px',
    async ({ design, frameId, json, label }) => {
      await breathe()
      const resources = cache.resources(bytes)
      const scene = render(design, frameId, undefined, textMeasure(ck, resources), bytes.variables)
      const drawn = rendererGlyphs(scene.layers, resources)
      const inFile = pdfGlyphs(pdfs.get(label) ?? renderVector(ck, json, frameId, bytes, 'pdf', cache))
      // Text drawn only as a mask lives in the PDF's soft masks, which this doesn't read.
      let worst = 0
      for (const g of inFile) {
        const nearest = Math.min(...(drawn.get(g.glyph) ?? []).map(([x, y]) => Math.hypot(x - g.x, y - g.y)))
        worst = Math.max(worst, nearest)
      }
      expect(worst, `largest distance over ${inFile.length} glyphs`).toBeLessThanOrEqual(0.05)
    },
  )

  it('names the file and its type for PDF and SVG', () => {
    const [c] = cases
    if (!c) throw new Error('no cases')
    for (const [type, mime] of [
      ['pdf', 'application/pdf'],
      ['svg', 'image/svg+xml'],
    ] as const) {
      const file = exportDesign(ck, c.json, { frameIds: [c.frameId], type }, bytes, cache)
      expect(file.type).toBe(mime)
      expect(file.name.endsWith(`.${type}`)).toBe(true)
    }
  })
})

describe('turned glyphs in PDF and SVG, and the glyphs a picture draws (#225)', () => {
  const WIDTH = 240
  const HEIGHT = 160
  const typeface = (bytes: Uint8Array) => {
    const face = ck.Typeface.MakeTypefaceFromData(bytes.slice().buffer)
    if (!face) throw new Error('CanvasKit could not read the font')
    return face
  }
  const notoSans = (weight: number) => {
    const face = loadFontFiles().find((f) => f.family === 'Noto Sans' && f.weight === weight)
    if (!face) throw new Error(`Noto Sans ${weight} is missing`)
    return typeface(face.bytes)
  }
  const letters = notoSans(400)
  const boldLetters = notoSans(800)
  const emoji = typeface(emojiTestFont())
  afterAll(() => {
    letters.delete()
    boldLetters.delete()
    emoji.delete()
  })

  /** A font of the face and size, unhinted. */
  const fontOf = (face: typeof letters, size: number) => {
    const font = new ck.Font(face, size)
    font.setHinting(ck.FontHinting.None)
    font.setSubpixel(true)
    return font
  }

  /** The text's glyphs, each turned by its angle in degrees about its origin and put at `x` plus `step` px a glyph, on `y`. */
  function turnedBlob(font: Font, text: string, angles: readonly number[], x: number, y: number, step = 40): TextBlob {
    const glyphs = font.getGlyphIDs(text)
    const xforms = [...glyphs].flatMap((_, i) => {
      const r = ((angles[i % angles.length] ?? 0) * Math.PI) / 180
      return [Math.cos(r), Math.sin(r), x + step * i, y]
    })
    return ck.TextBlob.MakeFromRSXformGlyphs(glyphs, xforms, font)
  }

  /** What `draw` draws, recorded. */
  function record(draw: (canvas: Canvas) => void): SkPicture {
    const recorder = new ck.PictureRecorder()
    draw(recorder.beginRecording(ck.XYWHRect(0, 0, WIDTH, HEIGHT)))
    const picture = recorder.finishRecordingAsPicture()
    recorder.delete()
    return picture
  }

  /** The picture drawn on the CPU surface over white. */
  function cpuPixels(picture: SkPicture): Pixels {
    const surface = ck.MakeSurface(WIDTH, HEIGHT)
    if (!surface) throw new Error('no surface')
    try {
      surface.getCanvas().clear(ck.WHITE)
      surface.getCanvas().drawPicture(picture)
      const image = surface.makeImageSnapshot()
      const pixels = image.readPixels(0, 0, {
        width: WIDTH,
        height: HEIGHT,
        colorType: ck.ColorType.RGBA_8888,
        alphaType: ck.AlphaType.Unpremul,
        colorSpace: ck.ColorSpace.SRGB,
      })
      image.delete()
      if (!(pixels instanceof Uint8Array)) throw new Error('no pixels')
      return { width: WIDTH, height: HEIGHT, pixels }
    } finally {
      surface.dispose()
    }
  }

  /** The picture played through DrawTextAsPaths into a one-page PDF and into an SVG that keeps text as text. */
  function asShapes(picture: SkPicture, keepColourGlyphs: boolean): { pdf: Uint8Array; svg: string } {
    const doc: PDFDocument = new ck.PDFDocument({
      title: '',
      author: '',
      creator: '',
      producer: '',
      lang: '',
      rasterDPI: 72,
      encodingQuality: 101,
    })
    const page = doc.beginPage(WIDTH, HEIGHT)
    if (!page) throw new Error('no PDF page')
    ck.DrawTextAsPaths(page, picture, keepColourGlyphs)
    doc.endPage()
    const pdf = doc.close()
    doc.delete()
    // Without SVG_CONVERT_TEXT_TO_PATHS, so text that reaches the SVG shows as a <text> element.
    const svgDoc = new ck.SVGDocument(WIDTH, HEIGHT, ck.SVG_NO_PRETTY_XML)
    const into = svgDoc.canvas()
    if (!into) throw new Error('no SVG canvas')
    ck.DrawTextAsPaths(into, picture, keepColourGlyphs)
    const svg = svgDoc.close()
    svgDoc.delete()
    if (!pdf || !svg) throw new Error('CanvasKit could not finish the files')
    return { pdf, svg: new TextDecoder().decode(svg) }
  }

  /** The largest share of differing pixels any recorded vector fixture allows, for each type. */
  const allowed = {
    pdf: Math.max(...Object.values(baselines).map((b) => b.pdf.limit)),
    svg: Math.max(...Object.values(baselines).map((b) => b.svg.limit)),
  }

  it('draws glyphs turned by 30° and 90° into a PDF and an SVG as paths, as the CPU draws them', async () => {
    const font = fontOf(boldLetters, 110)
    const blob = turnedBlob(font, 'Turn', [30, 90], 2, 76, 52)
    const paint = new ck.Paint()
    paint.setAntiAlias(true)
    paint.setColor(ck.BLACK)
    const picture = record((canvas) => canvas.drawTextBlob(blob, 6, 4, paint))
    const { pdf, svg } = asShapes(picture, false)
    const cpu = cpuPixels(picture)
    for (const object of [picture, blob, paint, font]) object.delete()

    expect(await pdfText(pdfium, pdf)).toBe('')
    expect(svg).not.toContain('<text')
    expect(svg).toContain('<path')
    const drawn = { pdf: await rasterisePdf(pdfium, pdf), svg: rasteriseSvg(new TextEncoder().encode(svg)) }
    // The share allowed is less than a letter covers, so a glyph dropped changes the dark pixels'
    // count and one put in the wrong place differs by more than the share.
    const dark = ({ pixels }: Pixels) => pixels.filter((v, i) => i % 4 === 0 && v < 128).length
    for (const type of ['pdf', 'svg'] as const) {
      expect(vectorDifference(cpu, drawn[type]), type).toBeLessThanOrEqual(allowed[type])
      expect(Math.abs(dark(drawn[type]) / dark(cpu) - 1), type).toBeLessThan(0.05)
    }
  })

  it('passes colour emoji on as text, once each, only with keepColourGlyphs', async () => {
    const font = fontOf(letters, 40)
    const emojiFont = fontOf(emoji, 40)
    const turnedLetters = turnedBlob(font, 'Hi', [30], 20, 60)
    const turnedEmoji = turnedBlob(emojiFont, '\u{1F600}', [30], 120, 60)
    const straightEmoji = ck.TextBlob.MakeFromText('\u{1F389}', emojiFont)
    const paint = new ck.Paint()
    paint.setColor(ck.BLACK)
    const picture = record((canvas) => {
      canvas.drawTextBlob(turnedLetters, 0, 0, paint)
      canvas.drawTextBlob(turnedEmoji, 10, 10, paint)
      canvas.drawTextBlob(straightEmoji, 20, 130, paint)
    })
    const kept = asShapes(picture, true)
    const dropped = asShapes(picture, false)
    const cpu = cpuPixels(picture)
    for (const object of [picture, turnedLetters, turnedEmoji, straightEmoji, paint, font, emojiFont]) object.delete()

    const count = (text: string, part: string) => text.split(part).length - 1
    const keptText = await pdfText(pdfium, kept.pdf)
    expect(count(keptText, '\u{1F600}')).toBe(1)
    expect(count(keptText, '\u{1F389}')).toBe(1)
    expect(keptText).not.toContain('H')
    expect(count(kept.svg, '<text')).toBe(2)
    expect(await pdfText(pdfium, dropped.pdf)).toBe('')
    expect(dropped.svg).not.toContain('<text')

    // Each emoji in its place: the box of the clearly coloured pixels, the turned one above y = 88
    // and the straight one below, is where the CPU draws it, within 2 px.
    const colouredBox = ({ pixels }: Pixels, top: number, bottom: number) => {
      const xs: number[] = []
      const ys: number[] = []
      for (let y = top; y < bottom; y++) {
        for (let x = 0; x < WIDTH; x++) {
          const i = (y * WIDTH + x) * 4
          const rgb = [pixels[i] ?? 0, pixels[i + 1] ?? 0, pixels[i + 2] ?? 0]
          if (Math.max(...rgb) - Math.min(...rgb) < 80) continue
          xs.push(x)
          ys.push(y)
        }
      }
      return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
    }
    const pdf = await rasterisePdf(pdfium, kept.pdf)
    for (const [top, bottom] of [
      [0, 88],
      [88, HEIGHT],
    ] as const) {
      const expected = colouredBox(cpu, top, bottom)
      expect(expected[2] ?? -Infinity, 'the CPU draws the emoji').toBeGreaterThan(expected[0] ?? Infinity)
      colouredBox(pdf, top, bottom).forEach((edge, i) =>
        expect(Math.abs(edge - (expected[i] ?? 0)), `rows ${top} to ${bottom}, edge ${i}`).toBeLessThanOrEqual(2),
      )
    }
  })

  it('gives the glyphs of a picture with a bounding box hierarchy left of and above the origin', () => {
    const font = fontOf(letters, 40)
    const blob = turnedBlob(font, 'Hi', [30], -200, -100)
    const paint = new ck.Paint()
    const recorder = new ck.PictureRecorder()
    recorder.beginRecording(ck.LTRBRect(-400, -400, 400, 400), true).drawTextBlob(blob, 0, 0, paint)
    const picture = recorder.finishRecordingAsPicture()
    recorder.delete()
    const outlines = ck.GlyphOutlines(picture)
    const [left = 0, top = 0, right = 0, bottom = 0] = [...outlines.computeTightBounds()]
    for (const object of [outlines, picture, blob, paint, font]) object.delete()

    expect(right).toBeGreaterThan(left)
    expect(right).toBeLessThan(0)
    expect(bottom).toBeLessThan(0)
    expect(top).toBeGreaterThan(-200)
  })

  it('gives the outlines of the glyphs a picture draws, placed as drawn, and nothing else', () => {
    const font = fontOf(letters, 48)
    const straightGlyphs = font.getGlyphIDs('Ab')
    const straight = ck.TextBlob.MakeFromGlyphs(straightGlyphs, font)
    const turnedGlyphs = font.getGlyphIDs('Hy')
    const turned = turnedBlob(font, 'Hy', [90], 140, 40)
    const paint = new ck.Paint()
    const picture = record((canvas) => {
      canvas.save()
      canvas.translate(7, 11)
      canvas.scale(1.5, 1.5)
      canvas.drawTextBlob(straight, 10, 60, paint)
      canvas.drawTextBlob(turned, 5, 8, paint)
      canvas.restore()
      canvas.drawRect(ck.XYWHRect(300, 300, 40, 40), paint)
    })
    const outlines: Path = ck.GlyphOutlines(picture)

    // Each glyph's own bounds, placed as drawn: the straight run along its advances, the turned run
    // turned a quarter, which maps (x, y) to (tx - y, ty + x), then the canvas's matrix.
    const place = (x: number, y: number) => [7 + 1.5 * x, 11 + 1.5 * y] as const
    const corners: (readonly [number, number])[] = []
    const edges = (bounds: Float32Array, i: number) =>
      [...bounds.slice(4 * i, 4 * i + 4)] as [number, number, number, number]
    const straightBounds = font.getGlyphBounds(straightGlyphs)
    const advances = font.getGlyphWidths(straightGlyphs)
    let pen = 10
    straightGlyphs.forEach((_, i) => {
      const [l, t, r, b] = edges(straightBounds, i)
      corners.push(place(pen + l, 60 + t), place(pen + r, 60 + b))
      pen += advances[i] ?? 0
    })
    const turnedBounds = font.getGlyphBounds(turnedGlyphs)
    turnedGlyphs.forEach((_, i) => {
      const [l, t, r, b] = edges(turnedBounds, i)
      const tx = 145 + 40 * i
      corners.push(place(tx - b, 48 + l), place(tx - t, 48 + r))
    })
    const expected = [
      Math.min(...corners.map(([x]) => x)),
      Math.min(...corners.map(([, y]) => y)),
      Math.max(...corners.map(([x]) => x)),
      Math.max(...corners.map(([, y]) => y)),
    ]
    const bounds = [...outlines.computeTightBounds()]
    const inRect = outlines.contains(320, 320)
    for (const object of [outlines, picture, straight, turned, paint, font]) object.delete()

    // A glyph's bounds are whole pixels round its outline, so the outlines lie inside the box
    // expected and less than a pixel, 1.5 once scaled, from each of its edges.
    const inward = [1, 1, -1, -1]
    bounds.forEach((edge, i) => {
      const gap = (edge - (expected[i] ?? Number.NaN)) * (inward[i] ?? 0)
      expect(gap, `edge ${i}`).toBeGreaterThanOrEqual(0)
      expect(gap, `edge ${i}`).toBeLessThan(1.5)
    })
    expect(inRect).toBe(false)
  })
})
