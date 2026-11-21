// PROTOTYPE. A realistic test set cut from the LICA dataset (CC BY 4.0, github.com/purvanshi-lica/lica-dataset):
// each text component of a layout, cropped from the layout's picture with its labelled font and cut
// out by its labelled colour (pixels near the text's colour are ink, pixels as far as the background
// are not), as the layering job gives a cut-out. Only components set in a family of our library,
// level, readable, standing out from their background, with no other text near, and whose line
// breaks are certain (one line, or breaks written in the text) are kept; at most `--per-family` a
// family, so a few popular families don't fill the set. Split by template: a third of the templates
// are the development part, the rest the test part. For testing and choosing checkpoints only; the
// crops and the layouts' pictures are never shipped.
//   node src/lica.ts --root <lica-data> --out <dir> [--per-family 20]
// Writes <out>/<id>.png (the cut-out) and <out>/truth.json.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'

import { loadCanvasKit } from '@dazbee/renderer/node'

import { type CatalogueFace, faceId, fallbackFaces, fontBytes, LIBRARY, scriptOf } from './catalogue.ts'
import { makeDrawer, type TextLook } from './draw.ts'
import { readPng, type Rgba, writePng } from './png.ts'

export interface LicaTruth {
  id: string
  part: 'dev' | 'test'
  template: string
  layout: string
  text: string
  family: string
  /** The exact face's id when the library has it at the labelled weight and slant. */
  face: string | null
  inSubset: boolean
  category: string
  script: string
  look: TextLook
}

const { values } = parseArgs({
  options: { root: { type: 'string' }, out: { type: 'string' }, 'per-family': { type: 'string', default: '20' } },
})
const root = values.root!
const out = values.out!
mkdirSync(out, { recursive: true })
const perFamily = Number(values['per-family'])
const ck = await loadCanvasKit()
const drawer = makeDrawer(ck, fallbackFaces(LIBRARY))
const families = new Map<string, CatalogueFace[]>()
for (const f of LIBRARY)
  if (!(f as { colour?: boolean }).colour) families.set(f.family, [...(families.get(f.family) ?? []), f])

const px = (v: unknown) => Number(String(v ?? '').replace('px', ''))
const hash = (s: string) => createHash('sha1').update(s).digest().readUInt32BE(0)

interface Component {
  type: string
  text?: string
  left?: string
  top?: string
  width?: string
  height?: string
  transform?: string
  color?: string
  fontSize?: string
  fontFamily?: string
  fontWeight?: string
  fontStyle?: string
  letterSpacing?: string
  lineHeight?: string
  textTransform?: string
  textAlign?: string
}

interface Candidate {
  truth: Omit<LicaTruth, 'id' | 'part'>
  image: string
  rect: [number, number, number, number]
}

const candidates: Candidate[] = []
let total = 0
const skipped: Record<string, number> = {}
const skip = (why: string) => {
  skipped[why] = (skipped[why] ?? 0) + 1
}
for (const template of readdirSync(join(root, 'layouts')).sort()) {
  for (const file of readdirSync(join(root, 'layouts', template)).sort()) {
    const layout = file.replace(/\.json$/, '')
    const image = join(root, 'images', template, `${layout}.png`)
    if (!existsSync(image)) continue
    const doc = JSON.parse(readFileSync(join(root, 'layouts', template, file), 'utf8')) as {
      components: Component[]
      width: string
      height: string
    }
    const texts = doc.components.filter((c) => c.type === 'TEXT')
    const boxes = texts.map(
      (c) => [px(c.left), px(c.top), px(c.width), px(c.height)] as [number, number, number, number],
    )
    texts.forEach((c, i) => {
      total++
      const [x, y, w, h] = boxes[i]!
      const rotate = /rotate\((-?[\d.]+)deg\)/.exec(c.transform ?? '')
      if ((c.transform && c.transform !== 'none' && !rotate) || (rotate && Math.abs(Number(rotate[1])) > 0.5))
        return skip('transformed')
      const family = (c.fontFamily ?? '').split('--')[0]!.trim()
      const faces = families.get(family)
      if (!faces) return skip('family not in the library')
      const size = px(c.fontSize)
      if (!(size >= 9)) return skip('too small')
      let text = (c.text ?? '').trim()
      if (!/\p{L}|\p{N}/u.test(text)) return skip('no letters')
      if ([...text.replace(/\s/g, '')].length < 3) return skip('fewer than three characters')
      if (c.textTransform === 'uppercase') text = text.toUpperCase()
      if (c.textTransform === 'lowercase') text = text.toLowerCase()
      const near = boxes.some(
        (b, j) => j !== i && overlap([x - size * 0.3, y - size * 0.3, w + size * 0.6, h + size * 0.6], b) > 0,
      )
      if (near) return skip('another text near')
      const weight = Number(c.fontWeight ?? (c.fontFamily ?? '').split('--')[1] ?? 400) || 400
      const style = c.fontStyle === 'italic' ? 'italic' : 'normal'
      const exact = faces.find((f) => f.weight === weight && f.style === style)
      const face =
        exact ??
        faces.reduce((a, b) =>
          Math.abs(b.weight - weight) + (b.style === style ? 0 : 1000) <
          Math.abs(a.weight - weight) + (a.style === style ? 0 : 1000)
            ? b
            : a,
        )
      if (!covers(face, text)) return skip('the face lacks a letter')
      const em = /(-?[\d.]+)em/.exec(c.letterSpacing ?? '')
      const spacing = em
        ? Number(em[1]) * 100
        : /(-?[\d.]+)px/.test(c.letterSpacing ?? '')
          ? (px(c.letterSpacing) / size) * 100
          : 0
      const lineHeight = px(c.lineHeight) / size || undefined
      const look: TextLook = {
        family,
        weight: face.weight,
        style: face.style,
        size,
        spacing,
        ...(lineHeight ? { lineHeight } : {}),
        align: c.textAlign === 'center' ? 'center' : c.textAlign === 'right' ? 'end' : 'start',
        color: rgbHex(c.color ?? 'rgb(0,0,0)'),
      }
      // Line breaks as the browser wrapped the text in its box, laid out again in the labelled face; kept
      // only when certain: one line, or the text's own breaks with no more wrapping.
      drawer.use([face])
      const wrapped = wrap(text, look, w)
      const lines = wrapped.split('\n').length
      if (lines !== text.split('\n').length) return skip('wrapped by the browser')
      if (lines > 6) return skip('more than six lines')
      const pitch = (lineHeight ?? 1.2) * size
      if (h > pitch * (lines + 0.8)) return skip('box taller than its lines')
      candidates.push({
        truth: {
          template,
          layout,
          text: wrapped,
          family,
          face: exact ? faceId(exact) : null,
          inSubset: face.menu,
          category: face.category,
          script: scriptOf(text),
          look,
        },
        image,
        rect: [x, y, w, Math.min(h, pitch * lines)],
      })
    })
  }
}

// At most perFamily a family, chosen by a hash of the layout and text so the choice is fixed.
const byFamily = new Map<string, Candidate[]>()
for (const c of candidates) byFamily.set(c.truth.family, [...(byFamily.get(c.truth.family) ?? []), c])
const chosen = [...byFamily.values()].flatMap((list) =>
  list.sort((a, b) => hash(a.truth.layout + a.truth.text) - hash(b.truth.layout + b.truth.text)).slice(0, perFamily),
)
chosen.sort((a, b) => hash(a.truth.layout + a.truth.text) - hash(b.truth.layout + b.truth.text))
const truths: LicaTruth[] = []
const images = new Map<string, Rgba>()
for (const [n, c] of chosen.entries()) {
  let img = images.get(c.image)
  if (!img) {
    if (images.size > 20) images.clear()
    images.set(c.image, (img = readPng(c.image)))
  }
  const m = Math.ceil(c.truth.look.size * 0.2)
  const x0 = Math.max(0, Math.floor(c.rect[0] - m))
  const y0 = Math.max(0, Math.floor(c.rect[1] - m))
  const x1 = Math.min(img.width, Math.ceil(c.rect[0] + c.rect[2] + m))
  const y1 = Math.min(img.height, Math.ceil(c.rect[1] + c.rect[3] + m))
  if (x1 - x0 < 8 || y1 - y0 < 8) continue
  const crop = new Uint8Array((x1 - x0) * (y1 - y0) * 4)
  for (let y = y0; y < y1; y++)
    crop.set(img.data.subarray((y * img.width + x0) * 4, (y * img.width + x1) * 4), (y - y0) * (x1 - x0) * 4)
  const cut = keyed({ width: x1 - x0, height: y1 - y0, data: crop }, c.truth.look.color)
  if (!cut) {
    skip('too close to its background to cut out')
    continue
  }
  const id = `l${String(n).padStart(4, '0')}`
  writePng(join(out, `${id}.png`), cut)
  truths.push({ id, part: hash(c.truth.template) % 3 === 0 ? 'dev' : 'test', ...c.truth })
}
writeFileSync(join(out, 'truth.json'), JSON.stringify(truths, null, 1))
console.log(
  `${total} text components; ${candidates.length} usable; ${truths.length} kept (${truths.filter((t) => t.part === 'dev').length} dev) over ${byFamily.size} families`,
)
console.log(skipped)

/**
 * The crop cut out by the text's colour: pixels within 15% of the way from the text's colour to the
 * background's (its border's median) are ink, past 75% none, between in proportion. Null when the
 * background is too near the text's colour (closer than 60 in RGB) to cut by colour.
 */
function keyed(img: Rgba, color: string): Rgba | null {
  const t = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16))
  const n = img.width * img.height
  const border: number[][] = [[], [], []]
  for (let x = 0; x < img.width; x++)
    for (const y of [0, img.height - 1])
      for (let c = 0; c < 3; c++) border[c]!.push(img.data[(y * img.width + x) * 4 + c]!)
  for (let y = 0; y < img.height; y++)
    for (const x of [0, img.width - 1])
      for (let c = 0; c < 3; c++) border[c]!.push(img.data[(y * img.width + x) * 4 + c]!)
  const b = border.map((v) => v.sort((p, q) => p - q)[Math.floor(v.length / 2)]!)
  const span = Math.hypot(b[0]! - t[0]!, b[1]! - t[1]!, b[2]! - t[2]!)
  if (span < 60) return null
  const data = new Uint8Array(img.data)
  for (let i = 0; i < n; i++) {
    const d = Math.hypot(img.data[i * 4]! - t[0]!, img.data[i * 4 + 1]! - t[1]!, img.data[i * 4 + 2]! - t[2]!) / span
    data[i * 4 + 3] = Math.round(255 * Math.max(0, Math.min(1, (0.75 - d) / 0.6)))
  }
  return { width: img.width, height: img.height, data }
}

function overlap(a: [number, number, number, number], b: [number, number, number, number]) {
  const w = Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0])
  const h = Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1])
  return w > 0 && h > 0 ? (w * h) / Math.max(1, a[2] * a[3]) : 0
}

function rgbHex(css: string) {
  const v = /rgba?\(([^)]+)\)/
    .exec(css)?.[1]
    ?.split(',')
    .map((s) => Number(s.trim())) ?? [0, 0, 0]
  return `#${v
    .slice(0, 3)
    .map((n) => Math.round(n).toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()}FF`
}

/** Breaks each paragraph where a line would grow wider than `width`, as a browser wraps words. */
function wrap(text: string, look: TextLook, width: number) {
  const single = { ...look, lineHeight: undefined }
  return text
    .split('\n')
    .map((para) => {
      const words = para.split(/\s+/).filter(Boolean)
      const lines: string[] = []
      let line = ''
      for (const w of words) {
        const next = line ? `${line} ${w}` : w
        if (line && drawer.measure(next, single).width > width + 1) {
          lines.push(line)
          line = w
        } else line = next
      }
      if (line) lines.push(line)
      return lines.join('\n')
    })
    .join('\n')
}

function covers(face: CatalogueFace, text: string) {
  const tf = ck.Typeface.MakeTypefaceFromData(fontBytes(face).buffer as ArrayBuffer)
  if (!tf) return false
  const font = new ck.Font(tf, 20)
  const ids = font.getGlyphIDs([...new Set(text.replace(/\s/g, ''))].join(''))
  font.delete()
  tf.delete()
  return [...ids].every((g) => g !== 0)
}
