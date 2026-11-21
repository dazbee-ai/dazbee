// PROTOTYPE. The synthetic test set: text blocks drawn by Dazbee's renderer with exact ground truth,
// then made to look generated (blur, lost resolution, noise, colour drift). Many faces, sizes,
// spacings, line heights, colours (some low contrast), outlines and small tilts; Latin, Arabic and
// Devanagari; cut-outs (as the cutting step gives) and flat crops (as an upload gives); a quarter
// with a pretend brand kit, a third of those with a kit that does not hold the true font.
//   node src/make-synthetic.ts --count 360 --seed 7
// Writes .data/synthetic/<id>.png, <id>-behind.png and truth.json. The first third is the dev part,
// the rest the held-out test part.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'

import { loadCanvasKit } from '@dazbee/renderer/node'

import { type CatalogueFace, DATA_DIR, faceId, loadCatalogue, type Script } from './catalogue.ts'
import { makeDrawer, type TextLook, textProps } from './draw.ts'
import { inkBox } from './ink.ts'
import { alphaInk, type Kit } from './match.ts'
import { hex } from './measure.ts'
import { type Rgba, writePng } from './png.ts'
import { ciede2000, lab } from './score.ts'
import { pick, rng } from './words.ts'

// Words kept apart from the fingerprint's samples (words.ts), so no test text was seen in training.
const EVAL_WORDS: Record<Script, string[]> = {
  latin: `harbour velvet canyon orchard lantern meadow citrus copper ember willow saffron marble
  thunder cascade horizon pepper almond cobalt crimson sterling nectar falcon prairie ginger
  voyage atlas fable glacier harvest jubilee kindred lagoon mosaic nimbus opal paddle quartz
  riverside sorbet tundra umbrella vortex whisper yonder zephyr 2026 $49 75% 12:30 No.1`.split(/\s+/).filter(Boolean),
  arabic: `بحر جبل نخلة قمر شمس نجمة زهرة حديقة مدينة سوق كتاب مدرسة ملعب سيارة طائرة قطار مطعم
  حلويات عصير فاكهة خضار مكتبة متحف شاطئ صحراء واحة`.split(/\s+/).filter(Boolean),
  devanagari: `समुद्र पहाड़ नदी चाँद सूरज तारा फूल बगीचा शहर बाज़ार किताब विद्यालय मैदान गाड़ी विमान रेल
  मिठाई रस फल सब्ज़ी पुस्तकालय संग्रहालय किनारा रेगिस्तान`.split(/\s+/).filter(Boolean),
}

export interface Truth {
  id: string
  part: 'dev' | 'test'
  script: Script
  text: string
  face: string
  family: string
  category: string
  look: TextLook
  rotation: number
  form: 'cutout' | 'flat'
  degradation: 'none' | 'mild' | 'strong'
  lowContrast: boolean
  background: number[]
  kit?: Kit
  /** Whether the kit holds the true font. */
  kitHasFont?: boolean
}

const { values } = parseArgs({ options: { count: { type: 'string', default: '360' }, seed: { type: 'string', default: '7' } } })
const count = Number(values.count)
const r = rng(Number(values.seed))
const dir = join(DATA_DIR, 'synthetic')
mkdirSync(dir, { recursive: true })
const ck = await loadCanvasKit()
const catalogue = loadCatalogue()
const drawer = makeDrawer(ck, catalogue.filter((f) => f.source === 'shipped'))
const menu = catalogue.filter((f) => f.menu)
const of = (s: Script) => menu.filter((f) => f.scripts?.includes(s))
const truths: Truth[] = []

const randomColor = () => [Math.floor(r() * 256), Math.floor(r() * 256), Math.floor(r() * 256)]
const dE = (a: number[], b: number[]) => ciede2000(lab(a[0]!, a[1]!, a[2]!), lab(b[0]!, b[1]!, b[2]!))

for (let k = 0; k < count; k++) {
  const u = r()
  const script: Script = u < 0.7 ? 'latin' : u < 0.85 ? 'arabic' : 'devanagari'
  const face: CatalogueFace = pick(r, of(script))
  const lines = 1 + (r() < 0.65 ? 0 : r() < 0.7 ? 1 : 2)
  const text = Array.from({ length: lines }, () => {
    const n = 1 + Math.floor(r() * 3)
    let t = Array.from({ length: n }, () => pick(r, EVAL_WORDS[script])).join(' ')
    if (script === 'latin') {
      const c = r()
      t = c < 0.3 ? t.toUpperCase() : c < 0.65 ? t.replace(/\b\p{L}/gu, (m) => m.toUpperCase()) : t
    }
    return t
  }).join('\n')
  const size = Math.round(18 * Math.exp(r() * Math.log(120 / 18)))
  const spacing = r() < 0.5 ? 0 : Math.round((-5 + r() * 30) * 2) / 2
  const lineHeight = lines > 1 ? Math.round((0.9 + r() * 0.7) * 100) / 100 : undefined
  const lowContrast = r() < 0.15
  const background = randomColor()
  let fill = randomColor()
  for (let t = 0; t < 50; t++) {
    const d = dE(fill, background)
    if (lowContrast ? d >= 10 && d <= 25 : d >= 35) break
    fill = randomColor()
  }
  const outlined = r() < 0.15
  const outline = outlined
    ? { width: Math.max(1, Math.min(Math.round(size * 0.08 * 2) / 2, 1 + Math.round(r() * 10) / 2)), color: hex(dE([0, 0, 0], fill) > 40 ? [0, 0, 0] : [255, 255, 255]) }
    : undefined
  const rotation = r() < 0.25 ? Math.round((r() < 0.5 ? -1 : 1) * (1 + r() * 9) * 2) / 2 : 0
  const look: TextLook = {
    family: face.family,
    weight: face.weight,
    style: face.style,
    size,
    spacing,
    ...(lineHeight ? { lineHeight } : {}),
    align: pick(r, ['start', 'center', 'end'] as const),
    color: hex(fill),
    ...(outline ? { outline } : {}),
  }
  drawer.use([face])
  const natural = drawer.measure(text, look)
  const pad = Math.ceil(size * 0.6 + 10)
  const side = Math.ceil(Math.hypot(natural.width, natural.height)) + 2 * pad
  const px = drawer.draw(side, side, null, textProps(text, look, { x: (side - natural.width) / 2, y: (side - natural.height) / 2, ...natural, rotation }))
  const box = inkBox(alphaInk(px, side, side), 0.02)
  if (!box) continue
  const m = 3
  const crop = cropRgba({ width: side, height: side, data: px }, box.x - m, box.y - m, box.w + 2 * m, box.h + 2 * m)
  const dg = r()
  const degradation = dg < 0.25 ? 'none' : dg < 0.7 ? 'mild' : 'strong'
  const form = r() < 0.7 ? 'cutout' : 'flat'
  const behind = backdrop(crop.width, crop.height, background)
  let img = degrade(crop, degradation)
  if (form === 'flat') img = flatten(img, behind)
  const id = `s${String(k).padStart(3, '0')}`
  writePng(join(dir, `${id}.png`), img)
  writePng(join(dir, `${id}-behind.png`), behind)
  const truth: Truth = {
    id,
    part: k < count / 3 ? 'dev' : 'test',
    script,
    text,
    face: faceId(face),
    family: face.family,
    category: face.category,
    look,
    rotation,
    form,
    degradation,
    lowContrast,
    background,
  }
  if (r() < 0.25) {
    // A pretend brand: Heading and Body fonts, its colours, a Headline style.
    const hasFont = r() < 0.67
    const other = pick(r, of(script).filter((f) => f.family !== face.family))
    const heading = hasFont ? face.family : other.family
    const body = pick(r, of(script).filter((f) => f.family !== face.family)).family
    const near = fill.map((c) => Math.max(0, Math.min(255, c + Math.round((r() - 0.5) * 6))))
    truth.kit = {
      fonts: [
        { token: 'heading', family: heading },
        { token: 'body', family: body },
      ],
      colors: [
        { token: 'primary', value: hex(near) },
        { token: 'secondary', value: hex(randomColor()) },
        { token: 'background', value: hex(background) },
      ],
      textStyles: [
        {
          token: 'headline',
          font: { token: 'heading' },
          fontWeight: hasFont ? face.weight : 700,
          fontStyle: hasFont ? face.style : 'normal',
          ...(lineHeight ? { lineHeight } : {}),
          letterSpacing: { unit: 'percent', value: hasFont ? spacing : -1 },
        },
      ],
    }
    truth.kitHasFont = hasFont
  }
  truths.push(truth)
  if (k % 20 === 0) process.stdout.write(`${k} `)
}
writeFileSync(join(dir, 'truth.json'), JSON.stringify(truths, null, 1))
console.log(`\n${truths.length} blocks`)

function cropRgba(img: Rgba, x: number, y: number, w: number, h: number): Rgba {
  const data = new Uint8Array(w * h * 4)
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const sx = x + i
      const sy = y + j
      if (sx < 0 || sy < 0 || sx >= img.width || sy >= img.height) continue
      data.set(img.data.subarray((sy * img.width + sx) * 4, (sy * img.width + sx) * 4 + 4), (j * w + i) * 4)
    }
  return { width: w, height: h, data }
}

/** A background with a gentle gradient and grain, as a generated picture has. */
function backdrop(w: number, h: number, base: number[]): Rgba {
  const data = new Uint8Array(w * h * 4)
  const gx = (r() - 0.5) * 20
  const gy = (r() - 0.5) * 20
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const t = (x / w - 0.5) * gx + (y / h - 0.5) * gy
      for (let c = 0; c < 3; c++) data[(y * w + x) * 4 + c] = Math.max(0, Math.min(255, Math.round(base[c]! + t + (r() - 0.5) * 6)))
      data[(y * w + x) * 4 + 3] = 255
    }
  return { width: w, height: h, data }
}

/** Blur, lost resolution, colour drift and noise, more for `strong`; premultiplied while filtering. */
function degrade(img: Rgba, level: 'none' | 'mild' | 'strong'): Rgba {
  if (level === 'none') return img
  const strong = level === 'strong'
  const { width: w, height: h } = img
  let p = new Float32Array(w * h * 4)
  for (let i = 0; i < w * h; i++) {
    const a = img.data[i * 4 + 3]! / 255
    for (let c = 0; c < 3; c++) p[i * 4 + c] = img.data[i * 4 + c]! * a
    p[i * 4 + 3] = a * 255
  }
  // Lost resolution: down by a factor and back up.
  const f = strong ? 0.45 + r() * 0.25 : 0.7 + r() * 0.2
  const sw = Math.max(2, Math.round(w * f))
  const sh = Math.max(2, Math.round(h * f))
  p = resize(resize(p, w, h, sw, sh), sw, sh, w, h)
  // Blur.
  p = gaussian(p, w, h, strong ? 0.8 + r() * 0.8 : 0.3 + r() * 0.5)
  // Colour drift over the block and grain.
  const drift = [r() - 0.5, r() - 0.5, r() - 0.5].map((v) => v * (strong ? 16 : 8))
  const out = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const a = p[i + 3]! / 255
      const wave = Math.sin((x / w) * Math.PI * 2 + drift[0]!) * 0.5
      for (let c = 0; c < 3; c++) {
        const v = a > 0.004 ? p[i + c]! / a : 0
        out[i + c] = Math.max(0, Math.min(255, Math.round(v + drift[c]! * wave + (r() - 0.5) * (strong ? 14 : 6))))
      }
      out[i + 3] = Math.max(0, Math.min(255, Math.round(p[i + 3]! + (a > 0.05 && a < 0.95 ? (r() - 0.5) * 30 : 0))))
    }
  return { width: w, height: h, data: out }
}

function flatten(img: Rgba, behind: Rgba): Rgba {
  const out = new Uint8Array(img.data.length)
  for (let i = 0; i < img.width * img.height; i++) {
    const a = img.data[i * 4 + 3]! / 255
    for (let c = 0; c < 3; c++) out[i * 4 + c] = Math.round(img.data[i * 4 + c]! * a + behind.data[i * 4 + c]! * (1 - a))
    out[i * 4 + 3] = 255
  }
  return { width: img.width, height: img.height, data: out }
}

function resize(src: Float32Array, w: number, h: number, dw: number, dh: number): Float32Array {
  const out = new Float32Array(dw * dh * 4)
  for (let y = 0; y < dh; y++)
    for (let x = 0; x < dw; x++) {
      const fx = ((x + 0.5) * w) / dw - 0.5
      const fy = ((y + 0.5) * h) / dh - 0.5
      const x0 = Math.max(0, Math.min(w - 1, Math.floor(fx)))
      const y0 = Math.max(0, Math.min(h - 1, Math.floor(fy)))
      const x1 = Math.min(w - 1, x0 + 1)
      const y1 = Math.min(h - 1, y0 + 1)
      const ax = Math.max(0, Math.min(1, fx - x0))
      const ay = Math.max(0, Math.min(1, fy - y0))
      for (let c = 0; c < 4; c++)
        out[(y * dw + x) * 4 + c] =
          src[(y0 * w + x0) * 4 + c]! * (1 - ax) * (1 - ay) +
          src[(y0 * w + x1) * 4 + c]! * ax * (1 - ay) +
          src[(y1 * w + x0) * 4 + c]! * (1 - ax) * ay +
          src[(y1 * w + x1) * 4 + c]! * ax * ay
    }
  return out
}

function gaussian(src: Float32Array, w: number, h: number, sigma: number): Float32Array {
  const rad = Math.ceil(sigma * 3)
  const k = Array.from({ length: 2 * rad + 1 }, (_, i) => Math.exp(-((i - rad) ** 2) / (2 * sigma * sigma)))
  const s = k.reduce((a, b) => a + b, 0)
  const kn = k.map((v) => v / s)
  const pass = (inp: Float32Array, dx: number, dy: number) => {
    const out = new Float32Array(inp.length)
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        for (let c = 0; c < 4; c++) {
          let v = 0
          for (let t = -rad; t <= rad; t++) {
            const xx = Math.max(0, Math.min(w - 1, x + t * dx))
            const yy = Math.max(0, Math.min(h - 1, y + t * dy))
            v += kn[t + rad]! * inp[(yy * w + xx) * 4 + c]!
          }
          out[(y * w + x) * 4 + c] = v
        }
    return out
  }
  return pass(pass(src, 1, 0), 0, 1)
}
