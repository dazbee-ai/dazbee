// PROTOTYPE. Our own realistic test set: text blocks laid out as ads set them (headlines, prices,
// offers, small print, buttons; Hindi and Arabic too), drawn by Dazbee's renderer in known library
// faces with outlines, drop shadows, gradients and tight or loose spacing, set over the background
// layers of test-ad development ads (the half the training samples never use, realistic.ts), and cut
// out as the layering job's text pictures are: soft or eroded edges, halos, specks.
//   node src/make-realistic.ts --count 450 --seed 31
// Writes .data/own/<id>.png (the cut-out), <id>-behind.png and truth.json. The first third is the
// development part (for choosing checkpoints and settings), the rest the test part, looked at once.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'

import { loadCanvasKit } from '@dazbee/renderer/node'

import { type CatalogueFace, DATA_DIR, faceId, fallbackFaces, fontBytes, LIBRARY, type Script } from './catalogue.ts'
import { makeDrawer, type TextLook, textProps } from './draw.ts'
import { inkBox } from './ink.ts'
import type { Truth } from './make-synthetic.ts'
import { alphaInk } from './match.ts'
import { hex } from './measure.ts'
import { writePng } from './png.ts'
import {
  backdropFiles,
  background,
  composite,
  contrasting,
  cutOut,
  loadBackdrops,
  meanColour,
  randomMatting,
} from './realistic.ts'
import { pick, rng } from './words.ts'

// Words of the ads' kinds, kept apart from the training samples' words (words.ts).
const HEADLINES =
  `Fresh Every Morning|Taste the Season|Built for Speed|Your Glow Starts Here|Weekend Escape|Brewed Slowly|Comfort Redefined|Made to Move|The Summer Edit|Bold New Flavour|Sleep Like Never Before|Golden Hour Collection|Pure Mountain Water|Feel the Rhythm|Crafted by Hand|Stay Curious|Little Luxuries|Ride the Wave|Back to Basics|Home Sweet Home|Grand Opening|Spice Up Your Life|Tiny Paws Big Love|Dream in Colour|Start Your Journey`.split(
    '|',
  )
const SUBHEADS =
  `handpicked ingredients delivered to your door|new arrivals every week|limited seats available|the smarter way to save|designed in small batches|fast shipping on every order|join thousands of happy customers|baked fresh since dawn|available in five colours|rated five stars by our guests|plan less and travel more|feel good from the inside out`.split(
    '|',
  )
const PRICES =
  `$49.99|$19|$249.00|€35|£12.50|₹1,299|50% OFF|SAVE 30%|Only $9|2 for $5|Buy 1 Get 1|UP TO 70% OFF|$0 Delivery|From $799|NOW $29.99|-40%`.split(
    '|',
  )
const SMALL =
  `*Terms and conditions apply. Offer valid while stocks last.|Free returns within 30 days of purchase.|Prices include all taxes. Limited time only.|Available at participating stores nationwide.|Images are for illustration purposes only.|Valid on orders above $50. Cannot be combined.`.split(
    '|',
  )
const BUTTONS =
  `Shop Now|Order Today|Book a Table|Learn More|Get Started|Sign Up Free|Claim Offer|Download App|Visit Us|Try It Free|Reserve Now|See the Menu`.split(
    '|',
  )
const HINDI =
  `त्योहार की खुशियाँ|आज ही ऑर्डर करें|स्वाद का जादू|नई शुरुआत|घर जैसा खाना|सिर्फ़ ₹४९९ में|मुफ़्त डिलीवरी|खुशियों की मिठास|अभी खरीदें|सीमित ऑफ़र`.split(
    '|',
  )
const ARABIC =
  `عرض لفترة محدودة|اطلب الآن|طعم لا يقاوم|تخفيضات الصيف|توصيل مجاني|جديدنا هذا الموسم|احجز طاولتك|أناقة كل يوم|خصم خمسين بالمئة|متعة السفر`.split(
    '|',
  )

type Kind = 'headline' | 'subhead' | 'price' | 'small' | 'button' | 'hindi' | 'arabic'

export interface OwnTruth extends Truth {
  kind: Kind
  shadow: boolean
  gradient: boolean
  matting: ReturnType<typeof randomMatting>
  /** The tilt the cutting step reports, as the test-ad blocks have it. */
  angle: number
}

const { values } = parseArgs({
  options: { count: { type: 'string', default: '450' }, seed: { type: 'string', default: '31' } },
})
const count = Number(values.count)
const r = rng(Number(values.seed))
const dir = join(DATA_DIR, 'own')
mkdirSync(dir, { recursive: true })
const ck = await loadCanvasKit()
const drawer = makeDrawer(ck, fallbackFaces(LIBRARY))
const backdrops = loadBackdrops(backdropFiles('test'))
const truths: OwnTruth[] = []
const of = (s: Script, inSubset: boolean) =>
  LIBRARY.filter((f) => !(f as { colour?: boolean }).colour && f.scripts?.includes(s) && f.menu === inSubset)

const uniform = (a: number, b: number) => a + r() * (b - a)

function covers(face: CatalogueFace, text: string) {
  const tf = ck.Typeface.MakeTypefaceFromData(fontBytes(face).buffer as ArrayBuffer)
  if (!tf) return false
  const font = new ck.Font(tf, 20)
  const ids = font.getGlyphIDs([...new Set(text.replace(/\s/g, ''))].join(''))
  font.delete()
  tf.delete()
  return [...ids].every((g) => g !== 0)
}

for (let k = 0; k < count; k++) {
  const u = r()
  const kind: Kind =
    u < 0.24
      ? 'headline'
      : u < 0.42
        ? 'subhead'
        : u < 0.58
          ? 'price'
          : u < 0.71
            ? 'small'
            : u < 0.83
              ? 'button'
              : u < 0.92
                ? 'hindi'
                : 'arabic'
  const script: Script = kind === 'hindi' ? 'devanagari' : kind === 'arabic' ? 'arabic' : 'latin'
  const inSubset = r() < 0.5
  const pool = of(script, inSubset).length > 0 ? of(script, inSubset) : of(script, !inSubset)
  let face: CatalogueFace = pick(r, pool)
  let text = ''
  let size = 0
  if (kind === 'headline') {
    const words = pick(r, HEADLINES).split(' ')
    const lines = words.length > 2 && r() < 0.5 ? 2 : 1
    const cut = Math.ceil(words.length / lines)
    text = lines === 2 ? `${words.slice(0, cut).join(' ')}\n${words.slice(cut).join(' ')}` : words.join(' ')
    if (r() < 0.4) text = text.toUpperCase()
    size = Math.round(uniform(40, 110))
  } else if (kind === 'subhead') {
    const t = pick(r, SUBHEADS)
    const words = t.split(' ')
    const lines = r() < 0.4 ? 2 : 1
    const cut = Math.ceil(words.length / lines)
    text = lines === 2 ? `${words.slice(0, cut).join(' ')}\n${words.slice(cut).join(' ')}` : t
    text = r() < 0.5 ? text.charAt(0).toUpperCase() + text.slice(1) : text
    size = Math.round(uniform(18, 36))
  } else if (kind === 'price') {
    text = pick(r, PRICES)
    size = Math.round(uniform(30, 110))
  } else if (kind === 'small') {
    const t = pick(r, SMALL)
    const words = t.split(' ')
    const lines = r() < 0.5 ? 2 : 1
    const cut = Math.ceil(words.length / lines)
    text = lines === 2 ? `${words.slice(0, cut).join(' ')}\n${words.slice(cut).join(' ')}` : t
    size = Math.round(uniform(11, 16))
  } else if (kind === 'button') {
    text = pick(r, BUTTONS)
    if (r() < 0.5) text = text.toUpperCase()
    size = Math.round(uniform(16, 30))
  } else {
    text = pick(r, kind === 'hindi' ? HINDI : ARABIC)
    size = Math.round(uniform(22, 80))
  }
  // The face must draw every letter itself, as the matcher's candidates must.
  for (let t = 0; t < 80 && !covers(face, text); t++) face = pick(r, pool)
  if (!covers(face, text)) continue
  // Spacing: plain half the time, else tight or loose (buttons and caps often loose).
  const s = r()
  const loose = kind === 'button' || /^[^a-z]+$/.test(text) ? 0.5 : 0.3
  const spacing =
    s < 0.5 ? 0 : s < 0.5 + loose ? Math.round(uniform(4, 40) * 2) / 2 : Math.round(uniform(-6, -1) * 2) / 2
  const lines = text.split('\n').length
  const lineHeight = lines > 1 ? Math.round(uniform(0.95, 1.5) * 100) / 100 : undefined
  const outlined = r() < 0.12 && size >= 24
  const shadowed = r() < 0.12
  const look: TextLook = {
    family: face.family,
    weight: face.weight,
    style: face.style,
    size,
    spacing,
    ...(lineHeight ? { lineHeight } : {}),
    align: pick(r, ['start', 'center', 'end'] as const),
    color: '#000000FF',
  }
  drawer.use([face])
  const natural = drawer.measure(text, look)
  const pad = Math.ceil(size * 0.6 + 12)
  const angle = r() < 0.1 ? Math.round(uniform(-8, 8) * 2) / 2 : 0
  const side = Math.ceil(Math.hypot(natural.width, natural.height)) + 2 * pad
  const behindFull = background(r, backdrops, side, side)
  const fill = contrasting(r, meanColour(behindFull), r() < 0.1)
  const gradient =
    !outlined && r() < 0.2 ? { fill, to: contrasting(r, meanColour(behindFull)), angle: r() * 360 } : undefined
  const styled: TextLook = {
    ...look,
    color: hex(fill),
    ...(outlined
      ? {
          outline: {
            width: Math.max(1, Math.round(size * uniform(0.02, 0.07) * 2) / 2),
            color: hex(contrasting(r, fill)),
          },
        }
      : {}),
  }
  const shadow = shadowed
    ? [
        {
          type: 'dropShadow',
          x: Math.round(size * uniform(-0.04, 0.08)),
          y: Math.round(size * uniform(0.02, 0.1)),
          blur: Math.round(r() * size * 0.12),
          spread: 0,
          color: hex([0, 0, 0], Math.round(uniform(80, 220))),
        },
      ]
    : []
  const props = {
    ...textProps(text, styled, {
      x: (side - natural.width) / 2,
      y: (side - natural.height) / 2,
      ...natural,
      rotation: angle,
    }),
    effects: shadow,
  }
  const px = drawer.draw(side, side, null, props)
  const box = inkBox(alphaInk(px, side, side), 0.02)
  if (!box) continue
  const m = 3
  const crop = (img: { width: number; height: number; data: Uint8Array }) => {
    const w = box.w + 2 * m
    const h = box.h + 2 * m
    const data = new Uint8Array(w * h * 4)
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const sx = box.x - m + x
        const sy = box.y - m + y
        if (sx < 0 || sy < 0 || sx >= side || sy >= side) continue
        data.set(img.data.subarray((sy * side + sx) * 4, (sy * side + sx) * 4 + 4), (y * w + x) * 4)
      }
    return { width: w, height: h, data }
  }
  const text0 = crop({ width: side, height: side, data: px })
  const behind = crop(behindFull)
  const comp = composite(text0, behind, gradient)
  const matting = randomMatting(r)
  const cut = cutOut(r, text0, comp, matting)
  const id = `o${String(k).padStart(3, '0')}`
  writePng(join(dir, `${id}.png`), cut)
  writePng(join(dir, `${id}-behind.png`), behind)
  truths.push({
    id,
    part: k < count / 3 ? 'dev' : 'test',
    script,
    text,
    face: faceId(face),
    family: face.family,
    inSubset: face.menu,
    category: face.category,
    look: styled,
    rotation: angle,
    angle,
    form: 'cutout',
    degradation:
      matting.soften > 0.6 || matting.halo > 0.15 || matting.specks > 0
        ? 'strong'
        : matting.soften > 0 || matting.shift !== 0
          ? 'mild'
          : 'none',
    lowContrast: false,
    background: meanColour(behind).map(Math.round),
    kind,
    shadow: shadowed,
    gradient: !!gradient,
    matting,
  })
  if (k % 25 === 0) process.stdout.write(`${k} `)
}
writeFileSync(join(dir, 'truth.json'), JSON.stringify(truths, null, 1))
console.log(`\n${truths.length} blocks`)
