// Checks a CanvasKit build in Node: it loads, draws a scene with text onto a PDF and an SVG canvas,
// still encodes PNG, JPEG and WebP like npm's full build, and shifts a run's baseline. Writes smoke.pdf
// and smoke.svg beside it.
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const dir = resolve(process.argv[2] ?? join(import.meta.dirname, 'bin'))
const ck = await createRequire(import.meta.url)(join(dir, 'canvaskit.js'))({ locateFile: (file) => join(dir, file) })

function drawScene(canvas) {
  const paint = new ck.Paint()
  paint.setAntiAlias(true)
  paint.setColor(ck.Color(255, 72, 176))
  canvas.drawRect(ck.XYWHRect(20, 20, 160, 100), paint)
  paint.setColor(ck.Color(61, 107, 255))
  canvas.drawCircle(200, 140, 40, paint)
  const font = new ck.Font(ck.Typeface.GetDefault(), 24)
  paint.setColor(ck.BLACK)
  canvas.drawText('Hello PDF', 30, 180, paint, font)
  font.delete()
  paint.delete()
}

const failures = []
const check = (ok, what) => (ok ? console.log(`ok   ${what}`) : failures.push(what) && console.log(`FAIL ${what}`))

const pdf = new ck.PDFDocument({
  title: 'Smoke',
  author: '',
  creator: '',
  producer: '',
  lang: 'en',
  rasterDPI: 300,
  encodingQuality: 101,
})
drawScene(pdf.beginPage(256, 256))
pdf.endPage()
const pdfBytes = pdf.close()
pdf.delete()
const pdfText = Buffer.from(pdfBytes).toString('latin1')
check(pdfText.startsWith('%PDF-'), `PDF starts with %PDF- (${pdfBytes.length} bytes)`)
check(pdfText.includes('/FontFile'), 'PDF embeds its font')
writeFileSync(join(dir, 'smoke.pdf'), pdfBytes)

const svg = new ck.SVGDocument(256, 256, 0)
drawScene(svg.canvas())
const svgText = new TextDecoder().decode(svg.close())
svg.delete()
check(svgText.includes('<svg'), `SVG has an <svg> element (${svgText.length} chars)`)
check(svgText.includes('<text'), 'SVG keeps text as <text>')
writeFileSync(join(dir, 'smoke.svg'), svgText)

const surface = ck.MakeSurface(64, 64)
drawScene(surface.getCanvas())
const image = surface.makeImageSnapshot()
for (const [name, format] of [
  ['PNG', ck.ImageFormat.PNG],
  ['JPEG', ck.ImageFormat.JPEG],
  ['WebP', ck.ImageFormat.WEBP],
]) {
  check((image.encodeToBytes(format, 90)?.length ?? 0) > 0, `encodes ${name}`)
}
image.delete()
surface.delete()

// A run's baseline shift (the text style's baselineShift, added by build/build.sh) moves the glyphs
// it draws by that many pixels, down for a positive shift, and leaves its line's height as it was.
const fontProvider = ck.TypefaceFontProvider.Make()
fontProvider.registerFont(readFileSync(join(import.meta.dirname, '../fonts/files/NotoSans-Regular.ttf')), 'Noto Sans')
const shiftedRun = (baselineShift) => {
  const builder = ck.ParagraphBuilder.MakeFromFontProvider(
    new ck.ParagraphStyle({ textStyle: new ck.TextStyle({ fontFamilies: ['Noto Sans'], fontSize: 40 }) }),
    fontProvider,
  )
  builder.pushStyle(new ck.TextStyle({ color: ck.BLACK, fontFamilies: ['Noto Sans'], fontSize: 40, baselineShift }))
  builder.addText('2')
  builder.pop()
  const paragraph = builder.build()
  paragraph.layout(1000)
  const textSurface = ck.MakeSurface(80, 120)
  textSurface.getCanvas().clear(ck.WHITE)
  textSurface.getCanvas().drawParagraph(paragraph, 0, 30)
  const pixels = textSurface
    .getCanvas()
    .readPixels(0, 0, { ...textSurface.imageInfo(), colorType: ck.ColorType.RGBA_8888 })
  const height = paragraph.getHeight()
  textSurface.delete()
  paragraph.delete()
  builder.delete()
  // The first row with a dark pixel: the top of the glyph's ink.
  const row = Array.from({ length: 120 }, (_, y) => y).find((y) =>
    Array.from({ length: 80 }, (_, x) => pixels[(y * 80 + x) * 4]).some((red) => red < 128),
  )
  return { top: row ?? -1, height }
}
const plainRun = shiftedRun(0)
const raisedRun = shiftedRun(-12)
check(
  raisedRun.top - plainRun.top === -12,
  `a baseline shift of -12 raises its glyph by 12 (${raisedRun.top - plainRun.top})`,
)
check(raisedRun.height === plainRun.height, `and keeps its line's height (${raisedRun.height}, ${plainRun.height})`)
fontProvider.delete()

if (failures.length > 0) process.exit(1)
