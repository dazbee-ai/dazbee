// PROTOTYPE. Runs Light and Medium over the DeltaX test ads or the synthetic set and writes every
// block's result to .data/results/<out>.json. Meant to run on one core (see REPORT.md):
//   cmd /c start /affinity 1 /wait /b node src/evaluate.ts --set deltax --model .data/models/w32-p48 --out deltax
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'

const t0 = performance.now()
const { loadCanvasKit } = await import('@dazbee/renderer/node')
const { DATA_DIR, fallbackFaces, FONTS_DIR, LIBRARY } = await import('./catalogue.ts')
const { adNames, loadAd } = await import('./deltax.ts')
const { makeDrawer } = await import('./draw.ts')
const { loadFingerprints, openModel } = await import('./fingerprint.ts')
const { matchBlock } = await import('./match.ts')
const { readPng } = await import('./png.ts')
const { ciede2000, lab } = await import('./score.ts')
type Truth = import('./make-synthetic.ts').Truth
type Block = import('./measure.ts').Block

const { values } = parseArgs({
  options: {
    set: { type: 'string', default: 'deltax' },
    model: { type: 'string', default: join(DATA_DIR, 'models', 'w32-p48') },
    versions: { type: 'string', default: 'light,medium' },
    part: { type: 'string', default: 'test' },
    out: { type: 'string' },
    limit: { type: 'string' },
    // Only these items, by id (comma-separated), for looking into one block.
    ids: { type: 'string' },
    // Only these DeltaX ads (comma-separated), for a timing run.
    ads: { type: 'string' },
    // Match against Dazbee's current catalogue (321 families) only, instead of the whole library.
    subset: { type: 'boolean', default: false },
  },
})
const versions = values.versions!.split(',') as ('light' | 'medium')[]

const ck = await loadCanvasKit()
const drawer = makeDrawer(ck, fallbackFaces(LIBRARY))
const catalogue = LIBRARY
const model = await openModel(join(values.model!, 'model.onnx'), 1)
const fingerprints = loadFingerprints(values.model!)
const ctx = { ck, drawer, model, fingerprints, catalogue, subset: values.subset! }
const startupMs = performance.now() - t0

interface Item {
  id: string
  ad?: string
  block: Block
  truth?: Truth
  lettering?: string
}
const items: Item[] = []
if (values.set === 'deltax') {
  const ads = values.ads ? values.ads.split(',') : adNames()
  for (const name of ads) for (const b of loadAd(name).blocks) items.push({ id: `${name}#${b.index}`, ad: name, block: b.block, lettering: b.lettering })
} else {
  const dir = join(DATA_DIR, 'synthetic')
  const truths = JSON.parse(readFileSync(join(dir, 'truth.json'), 'utf8')) as Truth[]
  for (const t of truths) {
    if (values.part !== 'all' && t.part !== values.part) continue
    const rgba = readPng(join(dir, `${t.id}.png`))
    const block: Block = { rgba, text: t.text, ...(t.form === 'cutout' ? { behind: readPng(join(dir, `${t.id}-behind.png`)) } : {}) }
    items.push({ id: t.id, block, truth: t })
  }
}
const wanted = values.ids ? new Set(values.ids.split(',')) : null
const chosen = wanted ? items.filter((i) => wanted.has(i.id)) : items
const limited = values.limit ? chosen.slice(0, Number(values.limit)) : chosen

const rgbOf = (h: string) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]
const dE = (a: string, b: string) => {
  const p = rgbOf(a)
  const q = rgbOf(b)
  return ciede2000(lab(p[0]!, p[1]!, p[2]!), lab(q[0]!, q[1]!, q[2]!))
}

const { measure } = await import('./measure.ts')
const { hasTransparency } = await import('./match.ts')
const { blurMatchedScore, inkDifference, whiteBlackScore } = await import('./score.ts')

/** Not the shared rule, measured after the match's time is taken: see score.ts. */
function diagnostics(block: Block, match: Awaited<ReturnType<typeof matchBlock>>) {
  const m = measure(block)
  drawer.use(catalogue.filter((f) => f.family === match.look.family))
  const pixels = { width: block.rgba.width, height: block.rgba.height, data: drawer.draw(block.rgba.width, block.rgba.height, null, match.layer) }
  const flat = !hasTransparency(block.rgba)
  return {
    matched: blurMatchedScore(block.rgba, pixels, m.background, flat ? m.ink.data : undefined),
    ink: inkDifference(m.ink.data, pixels),
    whiteBlack: whiteBlackScore(block.rgba, pixels, m.background, flat),
  }
}

const results: Record<string, unknown>[] = []
let peakRss = 0
for (const [n, item] of limited.entries()) {
  for (const version of versions) {
    const m = await matchBlock(ctx, item.block, version, item.truth?.kit)
    peakRss = Math.max(peakRss, process.memoryUsage().rss)
    const t = item.truth
    results.push({
      id: item.id,
      ad: item.ad,
      version,
      lettering: item.lettering,
      text: item.block.text,
      width: item.block.rgba.width,
      height: item.block.rgba.height,
      keep: m.keepAsPicture,
      ssim: m.score.ssim,
      deltaE: m.score.deltaE,
      same: m.score.same,
      ...diagnostics(item.block, m),
      layer: m.layer,
      ms: m.ms,
      draws: m.draws,
      look: m.look,
      place: m.place,
      bindings: m.bindings,
      brandTextStyle: m.brandTextStyle,
      shortlist: m.shortlist.slice(0, 5),
      ...(t
        ? {
            truth: { face: t.face, family: t.family, inSubset: t.inSubset, category: t.category, script: t.script, form: t.form, degradation: t.degradation, lowContrast: t.lowContrast, brand: !!t.kit, kitHasFont: t.kitHasFont, look: t.look, rotation: t.rotation },
            familyOk: m.look.family === t.family,
            faceOk: m.look.family === t.family && m.look.weight === t.look.weight && m.look.style === t.look.style,
            inShortlist: m.shortlist.some((f) => f.startsWith(`${t.family}|`)),
            sizeErr: Math.abs(m.look.size - t.look.size) / t.look.size,
            spacingErr: Math.abs(m.look.spacing - t.look.spacing),
            lineHeightErr: t.look.lineHeight ? Math.abs((m.look.lineHeight ?? 1.2) - t.look.lineHeight) : null,
            colorDE: dE(m.look.color, t.look.color),
            rotationErr: Math.abs(m.place.rotation - t.rotation),
            outlineFound: !!m.look.outline === !!t.look.outline,
            fontBound: m.bindings.fontFamily ?? null,
            colorBound: m.bindings.textColor ?? null,
          }
        : {}),
    })
  }
  if (n % 10 === 0) process.stdout.write(`${n} `)
}
const ru = process.resourceUsage()
const size = (p: string) => statSync(p).size
const out = {
  set: values.set,
  subset: values.subset,
  part: values.part,
  model: values.model,
  startupMs,
  peakRssMb: peakRss / 2 ** 20,
  maxRssMb: ru.maxRSS / 1024,
  cpuUserMs: ru.userCPUTime / 1000,
  sizes: {
    modelBytes: size(join(values.model!, 'model.onnx')),
    fingerprintsBytes: size(join(values.model!, 'fingerprints.f32')) + size(join(values.model!, 'fingerprint-faces.json')),
    catalogueBytes: size(join(FONTS_DIR, 'library.json')),
  },
  results,
}
mkdirSync(join(DATA_DIR, 'results'), { recursive: true })
writeFileSync(join(DATA_DIR, 'results', `${values.out ?? values.set}.json`), JSON.stringify(out, null, 1))
console.log(`\n${results.length} results; startup ${startupMs.toFixed(0)} ms; peak rss ${(peakRss / 2 ** 20).toFixed(0)} MB`)
