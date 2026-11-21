/* eslint-disable max-lines -- PROTOTYPE: one file holds the whole match so it reads top to bottom */
// PROTOTYPE. Matches one text block to a Dazbee text layer, in two versions:
//   Light: brand fonts first, the faces whose script fits, the fingerprint's 5 nearest; each fitted
//          from the measurements (size, letter spacing, line height) and drawn once to compare.
//   Medium: the same with the 25 nearest, then the best few tried in their family's other weights,
//          then size, spacing, line height, position, tilt and outline tuned by drawing and comparing.
// Either keeps the block as a picture when the best result does not look the same (score.ts).
import type { CanvasKit, Typeface } from '@dazbee/canvaskit'

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { type CatalogueFace, faceId, FONTS_DIR, fontBytes, scriptOf } from './catalogue.ts'
import { coversFromIndex } from './coverage.ts'
import { type Drawer, type Placed, type TextLook, textProps } from './draw.ts'
import { blockFingerprint, type Fingerprints, type Model, nearest, similarity } from './fingerprint.ts'
import { type Box, type Ink, inkBox, inkOf } from './ink.ts'
import { type Block, findLines, hex, type Measured, measure } from './measure.ts'
import { ciede2000, lab, type Score, score } from './score.ts'

export type Version = 'light' | 'medium'

/** A pretend or real brand kit, as `packages/schema` holds it (only what matching reads). */
export interface Kit {
  colors: { token: string; value: string }[]
  fonts: { token: string; family: string }[]
  textStyles: {
    token: string
    font: { token: string } | { family: string }
    fontWeight: number
    fontStyle: 'normal' | 'italic'
    lineHeight?: number
    letterSpacing: { unit: 'px' | 'percent'; value: number }
  }[]
}

export interface MatchContext {
  ck: CanvasKit
  drawer: Drawer
  model: Model
  fingerprints: Fingerprints
  catalogue: CatalogueFace[]
  /** Match only against Dazbee's current catalogue (faces marked `menu`), not the whole library. */
  subset: boolean
}

export interface Match {
  keepAsPicture: boolean
  /** The text layer's props as Dazbee stores them, in the block's pixels; given also when kept as a picture. */
  layer: Record<string, unknown>
  look: TextLook
  place: Placed
  /** Bindings to the brand kit, as a layer's `bindings` hold them. */
  bindings: { fontFamily?: string; textColor?: string }
  brandTextStyle?: string
  score: Score
  /** The faces tried, best first, by id. */
  shortlist: string[]
  draws: number
  ms: number
}

interface Fitted {
  face: CatalogueFace
  look: TextLook
  /** The layer in the level block: before the tilt is put back. */
  place: Placed
  /** What candidates are ordered by. */
  rank: number
  /** How well the ink overlaps where it is drawn (softIou). */
  overlap: number
  /** How well the letters' shapes match, each piece free to move a little (elasticIou). */
  shape: number
  /** The drawn text's lines, in the level block once placed. */
  lines: Box[]
  /** How many places letter spacing goes in each line: between its ink's first and last glyph. */
  lineGaps?: number[]
  brandToken?: string
}

/** Typefaces read to check letters the coverage index lacks, kept across blocks (the most recent, up to 32 MB of files). */
const typefaces = new Map<string, Typeface | null>()
const typefaceBytes = new Map<string, number>()
let typefaceTotal = 0

function coversByLoading(ck: CanvasKit, face: CatalogueFace, text: string) {
  let tf = typefaces.get(face.file)
  if (tf === undefined) {
    const bytes = fontBytes(face)
    tf = ck.Typeface.MakeTypefaceFromData(bytes.buffer as ArrayBuffer)
    typefaces.set(face.file, tf)
    typefaceBytes.set(face.file, bytes.length)
    typefaceTotal += bytes.length
    while (typefaceTotal > 32 * 2 ** 20 && typefaces.size > 1) {
      const [oldest, old] = typefaces.entries().next().value!
      old?.delete()
      typefaces.delete(oldest)
      typefaceTotal -= typefaceBytes.get(oldest) ?? 0
      typefaceBytes.delete(oldest)
    }
  }
  if (!tf) return false
  const letters = [...new Set(text.replace(/\s/g, ''))].join('')
  const font = new ck.Font(tf, 20)
  const ids = font.getGlyphIDs(letters)
  font.delete()
  return [...ids].every((g) => g !== 0)
}

/**
 * Novelty faces that draw a pattern instead of letters' strokes (a grid of squares, stripes, a filled
 * box: train/novelty.py, from each face's drawn probe), left out of the candidates as colour fonts are.
 */
const NOVELTY: ReadonlySet<string> = new Set(
  existsSync(join(FONTS_DIR, 'novelty.json')) && process.env.NOVELTY !== '0'
    ? (JSON.parse(readFileSync(join(FONTS_DIR, 'novelty.json'), 'utf8')) as string[])
    : [],
)

const SHORTLIST: Record<Version, number> = { light: 5, medium: 25 }
/**
 * How much the fingerprint's similarity adds to a candidate's rank (0: shape only), and how many
 * candidates are drawn in full and scored by the shared rule at the end: chosen on the synthetic
 * development part (FUSE 0, 0.25, 0.5, 1 × 2 or 5 finalists), never the test part.
 */
const FUSE = Number(process.env.FUSE ?? 0.5)
const FINALISTS_OF: Record<Version, number> = { light: 2, medium: 5 }
/** Which score orders candidates: the letters' shapes (default), the plain overlap, or both. */
const RANK = process.env.RANK ?? 'shape'
/** How much a brand font may trail the best other font and still be chosen. */
const BRAND_MARGIN = 0.03
/** A colour this close to a brand colour (ΔE) is taken as that colour and bound to it. */
const BRAND_COLOR_DELTA = 8

/**
 * The tallest line, in pixels, the match works at: a block with taller lines is matched shrunk to this
 * and its result scaled back and scored once at full size, so a huge block costs what a normal one does.
 */
const WORK_LINE = Number(process.env.WORK_LINE ?? 160)

export async function matchBlock(ctx: MatchContext, block: Block, version: Version, kit?: Kit): Promise<Match> {
  const started = performance.now()
  const lines = block.text.split('\n').length
  // The ink's height without the tilt undone is enough to decide.
  const box = inkBox(inkOf(block.rgba))
  const k = box ? WORK_LINE / (box.h / lines) : 1
  if (!(k < 0.95)) return matchAt(ctx, block, version, kit)
  const full = measure(block)
  const small = await matchAt(ctx, scaleBlock(block, k), version, kit)
  const look: TextLook = {
    ...small.look,
    size: small.look.size / k,
    ...(small.look.outline
      ? { outline: { ...small.look.outline, width: Math.round((small.look.outline.width / k) * 2) / 2 } }
      : {}),
  }
  const place = {
    ...small.place,
    x: small.place.x / k,
    y: small.place.y / k,
    width: small.place.width / k,
    height: small.place.height / k,
  }
  const layer = textProps(block.text, look, place)
  ctx.drawer.use(
    ctx.catalogue.filter((f) => f.family === look.family && f.weight === look.weight && f.style === look.style),
  )
  const drawn = ctx.drawer.draw(block.rgba.width, block.rgba.height, null, layer)
  const pixels = { width: block.rgba.width, height: block.rgba.height, data: drawn }
  const s = score(block.rgba, pixels, full.background, hasTransparency(block.rgba) ? undefined : full.ink.data)
  return {
    ...small,
    layer,
    look,
    place,
    score: s,
    keepAsPicture: !s.same,
    draws: small.draws + 1,
    ms: performance.now() - started,
  }
}

/** A block shrunk by `k` (area-averaged, premultiplied), with what is behind it. */
function scaleBlock(block: Block, k: number): Block {
  const shrink = (img: Block['rgba']) => {
    const w = Math.max(1, Math.round(img.width * k))
    const h = Math.max(1, Math.round(img.height * k))
    const acc = new Float64Array(w * h * 4)
    const cnt = new Float64Array(w * h)
    for (let y = 0; y < img.height; y++) {
      const ty = Math.min(h - 1, Math.floor((y * h) / img.height))
      for (let x = 0; x < img.width; x++) {
        const tx = Math.min(w - 1, Math.floor((x * w) / img.width))
        const i = (y * img.width + x) * 4
        const o = ty * w + tx
        const a = img.data[i + 3]! / 255
        for (let c = 0; c < 3; c++) acc[o * 4 + c]! += img.data[i + c]! * a
        acc[o * 4 + 3]! += a
        cnt[o]! += 1
      }
    }
    const data = new Uint8Array(w * h * 4)
    for (let o = 0; o < w * h; o++) {
      const a = acc[o * 4 + 3]!
      for (let c = 0; c < 3; c++) data[o * 4 + c] = a > 0 ? Math.round(acc[o * 4 + c]! / a) : 0
      data[o * 4 + 3] = Math.round((255 * a) / Math.max(1, cnt[o]!))
    }
    return { width: w, height: h, data }
  }
  return { ...block, rgba: shrink(block.rgba), ...(block.behind ? { behind: shrink(block.behind) } : {}) }
}

async function matchAt(ctx: MatchContext, block: Block, version: Version, kit?: Kit): Promise<Match> {
  const started = performance.now()
  let draws = 0
  const m = measure(block)
  const text = block.text
  const script = scriptOf(text)

  /** Whether a face draws every letter of the text itself, without a fallback. */
  const covers = (face: CatalogueFace) => coversFromIndex(face, text) ?? coversByLoading(ctx.ck, face, text)

  // The faces allowed: drawing the text's script, no colour fonts (Dazbee's catalogue leaves them
  // out), and in the 321-family mode only the faces Dazbee offers today.
  const byId = new Map(ctx.catalogue.map((f) => [faceId(f), f]))
  const allowed = ctx.fingerprints.faces
    .map((id, i) => ({ face: byId.get(id), i }))
    .filter(
      ({ face, i }) =>
        face &&
        !(face as { colour?: boolean }).colour &&
        !NOVELTY.has(ctx.fingerprints.faces[i]!) &&
        (!ctx.subset || face.menu) &&
        face.scripts?.includes(script),
    )
    .map(({ i }) => i)
  const fp = await blockFingerprint(ctx.model, m.level, m.lines)
  const near = nearest(ctx.fingerprints, fp, allowed, SHORTLIST[version] * 3)
  const shortlist: CatalogueFace[] = []
  for (const { face } of near) {
    const f = byId.get(ctx.fingerprints.faces[face]!)!
    if (covers(f)) shortlist.push(f)
    if (shortlist.length >= SHORTLIST[version]) break
  }

  // Brand first: the kit's fonts, each in its faces nearest the fingerprint (two in Light, all in Medium).
  const brandFaces: { face: CatalogueFace; token: string }[] = []
  for (const font of kit?.fonts ?? []) {
    const faces = ctx.catalogue.filter((f) => f.family === font.family && f.scripts?.includes(script) && covers(f))
    const ranked = nearest(
      ctx.fingerprints,
      fp,
      faces.map((f) => ctx.fingerprints.faces.indexOf(faceId(f))).filter((i) => i >= 0),
      version === 'light' ? 2 : faces.length,
    )
    for (const r of ranked) brandFaces.push({ face: byId.get(ctx.fingerprints.faces[r.face]!)!, token: font.token })
  }

  const tryFaces = [...brandFaces.map((b) => b.face), ...shortlist]
  ctx.drawer.use(tryFaces)
  const fits: Fitted[] = []
  const fitOne = (face: CatalogueFace, brandToken?: string) => {
    const fit = fitFace(ctx.drawer, m, text, face, () => draws++)
    if (fit) fits.push({ ...fit, ...(brandToken ? { brandToken } : {}) })
  }
  for (const b of brandFaces) fitOne(b.face, b.token)
  for (const f of shortlist) if (!brandFaces.some((b) => b.face === f)) fitOne(f)

  if (version === 'medium' && fits.length > 0) {
    // The best three families, in their other weights of the same style.
    const top = [...fits].sort((a, b) => b.rank - a.rank).slice(0, 3)
    const siblings = top.flatMap((t) =>
      ctx.catalogue.filter(
        (f) =>
          (!ctx.subset || f.menu) &&
          f.family === t.face.family &&
          f.style === t.face.style &&
          f.weight !== t.face.weight &&
          !NOVELTY.has(faceId(f)) &&
          !fits.some((x) => x.face === f),
      ),
    )
    ctx.drawer.use([...tryFaces, ...siblings])
    for (const s of siblings) if (covers(s)) fitOne(s, top.find((t) => t.face.family === s.family)?.brandToken)
  }

  // Each fit's rank adds the fingerprint's own vote: the shape score plus FUSE × the cosine
  // similarity of the block's fingerprint to the face's.
  if (FUSE > 0) {
    const index = new Map(ctx.fingerprints.faces.map((id, i) => [id, i]))
    for (const f of fits) {
      const i = index.get(faceId(f.face))
      if (i === undefined) continue
      f.rank = f.shape + FUSE * similarity(ctx.fingerprints, i, fp)
    }
  }
  fits.sort((a, b) => b.rank - a.rank)
  // The leaders corrected from their own draws: Light its best two once, Medium its best three twice.
  const leaders = version === 'light' ? 2 : 3
  for (let i = 0; i < Math.min(leaders, fits.length); i++)
    for (let r = 0; r < (version === 'light' ? 1 : 2); r++)
      fits[i] = refit(ctx.drawer, m, text, fits[i]!, () => draws++)
  const brandLead = fits.findIndex((f) => f.brandToken)
  if (brandLead >= leaders) fits[brandLead] = refit(ctx.drawer, m, text, fits[brandLead]!, () => draws++)
  if (FUSE > 0) {
    const index = new Map(ctx.fingerprints.faces.map((id, i) => [id, i]))
    for (const f of fits) {
      const i = index.get(faceId(f.face))
      if (i === undefined) continue
      f.rank = f.shape + FUSE * similarity(ctx.fingerprints, i, fp)
    }
  }
  fits.sort((a, b) => b.rank - a.rank)
  const first = choose(fits)
  if (!first) {
    return keep(m, text, shortlist, draws, started)
  }
  // The finalists: the choice and the next best (tuned in Medium), each drawn in full and scored by
  // the shared rule; the first that looks the same wins, else the one that comes closest.
  const finalistCount = process.env.FINALISTS ? Number(process.env.FINALISTS) : FINALISTS_OF[version]
  let finalists = [first, ...fits.filter((f) => f !== first).slice(0, finalistCount - 1)]
  if (version === 'medium')
    finalists = finalists.map((f, i) => (i < 2 ? tune(ctx.drawer, m, text, f, () => draws++) : f))
  const finished = finalists.map((f) => finish(ctx, block, m, text, f, kit, () => draws++))
  const won =
    finished.find((f) => f.score.same) ?? [...finished].sort((a, b) => quality(b.score) - quality(a.score))[0]!
  return {
    keepAsPicture: !won.score.same,
    ...won,
    shortlist: fits.map((f) => faceId(f.face)),
    draws,
    ms: performance.now() - started,
  }
}

/** How close a result comes to looking the same: SSIM, less a hundredth of the mean ΔE. */
const quality = (s: Score) => s.ssim - s.deltaE / 100

/**
 * A fit made into the text layer: its colour and outline from the block, snapped to the brand's
 * colours when close (and bound to them), its brand text style when one matches and draws as well,
 * placed back in the tilted block and scored by the shared rule.
 */
function finish(
  ctx: MatchContext,
  block: Block,
  m: Measured,
  text: string,
  fit: Fitted,
  kit: Kit | undefined,
  counted: () => void,
) {
  let best = fit
  const bindings: Match['bindings'] = {}
  let color = hex(m.fill)
  const near = nearestBrandColor(m.fill, kit)
  if (near) {
    color = near.value
    bindings.textColor = `brand:${near.token}`
  }
  if (best.brandToken) bindings.fontFamily = `brand:${best.brandToken}`
  let look: TextLook = { ...best.look, color }
  if (m.outline) {
    const oc = nearestBrandColor(m.outline.color, kit)
    look = {
      ...look,
      outline: { width: best.look.outline?.width ?? m.outline.width, color: oc ? oc.value : hex(m.outline.color) },
    }
  }
  // A brand text style is taken when it draws as well as the fit (within 0.01), placed again with its values.
  let style = best.brandToken ? brandStyle(kit!, best, m.lines.length) : undefined
  if (style) {
    const styled = placeAndRank(
      ctx.drawer,
      m,
      text,
      best.face,
      { ...best.look, spacing: style.spacing, ...(style.lineHeight ? { lineHeight: style.lineHeight } : {}) },
      counted,
    )
    if (styled && styled.overlap >= best.overlap - 0.01) {
      best = { ...styled, brandToken: best.brandToken! }
      look = {
        ...look,
        spacing: styled.look.spacing,
        ...(styled.look.lineHeight ? { lineHeight: styled.look.lineHeight } : {}),
      }
    } else style = undefined
  }
  const place = untilt(best.place, m)
  const layer = textProps(text, look, place)
  const drawn = ctx.drawer.draw(block.rgba.width, block.rgba.height, null, layer)
  counted()
  const pixels = { width: block.rgba.width, height: block.rgba.height, data: drawn }
  const flat = !hasTransparency(block.rgba)
  const s = score(block.rgba, pixels, m.background, flat ? m.ink.data : undefined)
  return { layer, look, place, bindings, ...(style ? { brandTextStyle: style.token } : {}), score: s }
}

/** The best fit, a brand font first when it trails the best by no more than BRAND_MARGIN. */
function choose(fits: Fitted[]): Fitted | undefined {
  const best = fits[0]
  const brand = fits.find((f) => f.brandToken)
  // The margin is in the letters' shape score, whatever else the rank adds.
  if (brand && best && brand.shape >= best.shape - BRAND_MARGIN) return brand
  return best
}

function keep(m: Measured, text: string, shortlist: CatalogueFace[], draws: number, started: number): Match {
  const look: TextLook = {
    family: 'Noto Sans',
    weight: 400,
    style: 'normal',
    size: m.box.h,
    spacing: 0,
    align: 'start',
    color: hex(m.fill),
  }
  const place = { x: m.box.x, y: m.box.y, width: m.box.w, height: m.box.h, rotation: m.angle }
  return {
    keepAsPicture: true,
    layer: textProps(text, look, place),
    look,
    place,
    bindings: {},
    score: { ssim: 0, deltaE: 99, same: false },
    shortlist: shortlist.map(faceId),
    draws,
    ms: performance.now() - started,
  }
}

const graphemes = (s: string) => [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s)].length

/**
 * Fits a face to the block from the measurements: drawn at 100 px to read its lines, then sized so
 * its lines are as tall as the block's, spaced so they are as wide, and led so they are as far
 * apart; drawn again in the block, moved so the ink centres meet, and ranked by how well the ink
 * overlaps.
 */
export function fitFace(
  drawer: Drawer,
  m: Measured,
  text: string,
  face: CatalogueFace,
  counted: () => void,
): Fitted | null {
  const lines = text.split('\n')
  const n = lines.length
  const base: TextLook = {
    family: face.family,
    weight: face.weight,
    style: face.style,
    size: 100,
    spacing: 0,
    ...(n > 1 ? { lineHeight: 1.2 } : {}),
    align: m.align,
    color: '#000000FF',
  }
  const baseInk = drawAlone(drawer, text, base, counted)
  if (!baseInk) return null
  const baseLines = findLines(baseInk.ink, baseInk.box, n)
  const ratios = m.lines
    .map((l, i) => l.box.h / Math.max(1, baseLines[i]!.box.h))
    .filter((r) => Number.isFinite(r) && r > 0)
  const size = 100 * median(ratios)
  // A face whose letters would need a size far from the block's line height cannot be it (and would
  // be drawn on huge surfaces): a quarter to four times the height of one line of the block.
  const perLine = m.box.h / n
  if (!(size >= perLine / 4 && size <= perLine * 4)) return null
  // Letter spacing: the width the lines lack at this size, shared over the places spacing goes. How
  // many there are is measured (a line laid out with and without spacing), since a script's clusters
  // and ligatures make it differ from the count of characters.
  const lineGaps = lines.map((l) => {
    if (!l.trim()) return 0
    const plain = drawer.measure(l, { ...base, lineHeight: undefined, size: 100, spacing: 0 }).width
    const spaced = drawer.measure(l, { ...base, lineHeight: undefined, size: 100, spacing: 20 }).width
    return Math.max(0, (spaced - plain) / 20 - 1)
  })
  let room = 0
  let gaps = 0
  m.lines.forEach((l, i) => {
    const k = lineGaps[i] ?? 0
    if (k <= 0) return
    room += l.box.w - (baseLines[i]!.box.w * size) / 100
    gaps += k
  })
  const spacing = gaps > 0 ? clamp(((room / gaps) * 100) / size, -25, 120) : 0
  let lineHeight: number | undefined
  if (n > 1) {
    const centre = (b: Box) => b.y + b.h / 2
    let sum = 0
    for (let i = 0; i + 1 < n; i++) {
      const blockPitch = centre(m.lines[i + 1]!.box) - centre(m.lines[i]!.box)
      const extra = centre(baseLines[i + 1]!.box) - centre(baseLines[i]!.box) - 120
      sum += (blockPitch - (extra * size) / 100) / size
    }
    lineHeight = clamp(sum / (n - 1), 0.5, 3)
  }
  const outline = m.outline ? { width: m.outline.width, color: '#000000FF' } : undefined
  const look: TextLook = {
    ...base,
    size,
    spacing,
    ...(lineHeight ? { lineHeight } : {}),
    ...(outline ? { outline } : {}),
  }
  const fit = placeAndRank(drawer, m, text, face, look, counted)
  return fit ? { ...fit, lineGaps } : null
}

/** Draws the look in the level block, moves it so the ink boxes' centres meet, and ranks it. */
export function placeAndRank(
  drawer: Drawer,
  m: Measured,
  text: string,
  face: CatalogueFace,
  look: TextLook,
  counted: () => void,
  nudge = { dx: 0, dy: 0 },
  /** The letters' shape score to keep, instead of measuring it again (tuning moves only the fit). */
  keepShape?: number,
): Fitted | null {
  const natural = drawer.measure(text, look)
  // First guess: the layer's box where the ink box is, then corrected by where the ink lands.
  const guess = { x: m.box.x + m.box.w / 2 - natural.width / 2, y: m.box.y + m.box.h / 2 - natural.height / 2 }
  // Drawn with a margin round the block, so ink that lands past its edge still counts.
  const pad = Math.ceil(Math.max(look.size, 16))
  const w = m.level.width + 2 * pad
  const h = m.level.height + 2 * pad
  const px = drawer.draw(
    w,
    h,
    null,
    textProps(text, look, { x: guess.x + pad, y: guess.y + pad, ...natural, rotation: 0 }),
  )
  counted()
  const ink = alphaInk(px, w, h)
  const box = inkBox(ink)
  if (!box) return null
  const dx = m.box.x + m.box.w / 2 - (box.x - pad + box.w / 2) + nudge.dx
  const dy = m.box.y + m.box.h / 2 - (box.y - pad + box.h / 2) + nudge.dy
  const overlap = softIou(m.level, ink, dx - pad, dy - pad)
  const shape = keepShape ?? elasticIou(m.level, ink, dx - pad, dy - pad, look.size)
  const rank = RANK === 'overlap' ? overlap : RANK === 'mix' ? (shape + overlap) / 2 : shape
  const lines = findLines(ink, box, m.lines.length).map((l) => ({
    ...l.box,
    x: l.box.x - pad + dx,
    y: l.box.y - pad + dy,
  }))
  return {
    face,
    look,
    place: { x: guess.x + dx, y: guess.y + dy, ...natural, rotation: 0 },
    rank,
    overlap,
    shape,
    lines,
  }
}

/**
 * One correction from the placed draw: size by how much taller the block's lines are than the
 * drawn ones, letter spacing by the width still missing, line height by the pitch still missing.
 * Kept when it ranks better.
 */
function refit(drawer: Drawer, m: Measured, text: string, fit: Fitted, counted: () => void): Fitted {
  const lines = text.split('\n')
  const ratio = median(m.lines.map((l, i) => l.box.h / Math.max(1, fit.lines[i]!.h)))
  const size = fit.look.size * ratio
  let room = 0
  let gaps = 0
  m.lines.forEach((l, i) => {
    const k = fit.lineGaps?.[i] ?? graphemes(lines[i] ?? '') - 1
    if (k <= 0) return
    room += l.box.w - fit.lines[i]!.w * ratio
    gaps += k
  })
  const spacing = gaps > 0 ? clamp(fit.look.spacing + ((room / gaps) * 100) / size, -25, 120) : fit.look.spacing
  let lineHeight = fit.look.lineHeight
  if (lines.length > 1 && lineHeight) {
    const centre = (b: Box) => b.y + b.h / 2
    let sum = 0
    for (let i = 0; i + 1 < lines.length; i++)
      sum +=
        centre(m.lines[i + 1]!.box) -
        centre(m.lines[i]!.box) -
        (centre(fit.lines[i + 1]!) - centre(fit.lines[i]!)) * ratio
    lineHeight = clamp(lineHeight + sum / (lines.length - 1) / size, 0.5, 3)
  }
  const look = { ...fit.look, size, spacing, ...(lineHeight ? { lineHeight } : {}) }
  if (!(size >= m.box.h / lines.length / 4 && size <= (m.box.h / lines.length) * 4)) return fit
  const tried = placeAndRank(drawer, m, text, fit.face, look, counted)
  return tried && tried.overlap > fit.overlap
    ? {
        ...tried,
        ...(fit.lineGaps ? { lineGaps: fit.lineGaps } : {}),
        ...(fit.brandToken ? { brandToken: fit.brandToken } : {}),
      }
    : fit
}

/**
 * Medium's tuning: size, letter spacing, line height, position, tilt and outline width, each moved
 * up and down by a step that halves when neither way helps, drawing and ranking each try.
 */
function tune(drawer: Drawer, m: Measured, text: string, start: Fitted, counted: () => void): Fitted {
  let best = start
  let nudge = { dx: 0, dy: 0 }
  const steps: Record<string, number> = { size: 0.03, spacing: 2, lineHeight: 0.05, dx: 1, dy: 1, outline: 0.5 }
  const multiline = text.includes('\n')
  for (let round = 0; round < 3; round++) {
    for (const key of Object.keys(steps)) {
      if (key === 'lineHeight' && !multiline) continue
      if (key === 'outline' && !best.look.outline) continue
      for (const sign of [1, -1]) {
        const look = { ...best.look }
        const n2 = { ...nudge }
        if (key === 'size') look.size = best.look.size * (1 + sign * steps.size!)
        if (key === 'spacing') look.spacing = best.look.spacing + sign * steps.spacing!
        if (key === 'lineHeight') look.lineHeight = (best.look.lineHeight ?? 1.2) + sign * steps.lineHeight!
        if (key === 'outline' && look.outline)
          look.outline = { ...look.outline, width: Math.max(0, look.outline.width + sign * steps.outline!) }
        if (key === 'dx') n2.dx += sign * steps.dx!
        if (key === 'dy') n2.dy += sign * steps.dy!
        const tried = placeAndRank(drawer, m, text, best.face, look, counted, n2, best.shape)
        if (tried && tried.overlap > best.overlap + 1e-4) {
          best = { ...tried, ...(start.brandToken ? { brandToken: start.brandToken } : {}) }
          nudge = n2
          break
        }
      }
    }
    for (const k of Object.keys(steps)) steps[k]! /= 2
  }
  return best
}

/** The text drawn alone at its natural size with a margin, as ink, and its ink box. */
function drawAlone(drawer: Drawer, text: string, look: TextLook, counted: () => void) {
  const natural = drawer.measure(text, look)
  const pad = Math.ceil(look.size * 0.6)
  const width = Math.ceil(natural.width + 2 * pad)
  const height = Math.ceil(natural.height + 2 * pad)
  const px = drawer.draw(width, height, null, textProps(text, look, { x: pad, y: pad, ...natural, rotation: 0 }))
  counted()
  const ink = alphaInk(px, width, height)
  const box = inkBox(ink)
  return box ? { ink, box } : null
}

export function alphaInk(px: Uint8Array, width: number, height: number): Ink {
  const data = new Float32Array(width * height)
  for (let i = 0; i < data.length; i++) data[i] = px[i * 4 + 3]! / 255
  return { width, height, data }
}

/**
 * How well two inks overlap once `b` is moved by (dx, dy): the soft intersection over the soft
 * union, after a slight blur so a sub-pixel difference costs little.
 */
export function softIou(a: Ink, b: Ink, dx: number, dy: number): number {
  const bb = blur(b)
  let ab = blurred.get(a)
  if (!ab) blurred.set(a, (ab = blur(a)))
  let inter = 0
  let union = 0
  let inside = 0
  for (let y = 0; y < a.height; y++)
    for (let x = 0; x < a.width; x++) {
      const va = ab[y * a.width + x]!
      const vb = sampleAt(bb, b.width, b.height, x - dx, y - dy)
      inside += vb
      inter += Math.min(va, vb)
      union += Math.max(va, vb)
    }
  // Ink drawn past the block's edges is all extra.
  let total = 0
  for (const v of bb) total += v
  union += Math.max(0, total - inside)
  return union > 0 ? inter / union : 0
}

/**
 * How well the letters' shapes match when each piece of the drawn text may move a little: the drawn
 * ink is cut into tiles half the font size wide, each tile is moved up to 8% of the size (at least
 * 2 px) each way to where it overlaps the block best, and the overlaps are summed as an intersection
 * over a union. Spacing that drifts along a line costs little; a wrong letter shape costs a lot.
 */
export function elasticIou(a: Ink, b: Ink, dx: number, dy: number, size: number): number {
  const box = inkBox(b, 0.05)
  if (!box) return 0
  const tile = Math.max(6, Math.round(size * 0.5))
  const r = Math.max(2, Math.round(size * 0.08))
  const ia = Math.round(dx)
  const ja = Math.round(dy)
  let inter = 0
  let union = 0
  let massA = 0
  for (let i = 0; i < a.data.length; i++) massA += a.data[i]!
  let coveredA = 0
  for (let ty = box.y; ty < box.y + box.h; ty += tile)
    for (let tx = box.x; tx < box.x + box.w; tx += tile) {
      let best = -1
      let bestI = 0
      let bestU = 0
      let bestA = 0
      let bx = 0
      let by = 0
      const tryShift = (sx: number, sy: number) => {
        let I = 0
        let U = 0
        let A = 0
        for (let y = ty; y < Math.min(ty + tile, box.y + box.h); y++)
          for (let x = tx; x < Math.min(tx + tile, box.x + box.w); x++) {
            const vb = b.data[y * b.width + x]!
            const ax = x + ia + sx
            const ay = y + ja + sy
            const va = ax < 0 || ay < 0 || ax >= a.width || ay >= a.height ? 0 : a.data[ay * a.width + ax]!
            I += Math.min(va, vb)
            U += Math.max(va, vb)
            A += va
          }
        const v = U > 0 ? I / U : 0
        if (v > best) {
          best = v
          bestI = I
          bestU = U
          bestA = A
          bx = sx
          by = sy
        }
      }
      // Coarse, every other pixel, then the pixels round the best.
      for (let sy = -r; sy <= r; sy += 2) for (let sx = -r; sx <= r; sx += 2) tryShift(sx, sy)
      const cx = bx
      const cy = by
      for (let sy = cy - 1; sy <= cy + 1; sy++)
        for (let sx = cx - 1; sx <= cx + 1; sx++) if (sx !== cx || sy !== cy) tryShift(sx, sy)
      inter += bestI
      union += bestU
      coveredA += bestA
    }
  // Block ink no tile reached is all missed.
  union += Math.max(0, massA - coveredA)
  return union > 0 ? inter / union : 0
}

/** The block's ink blurred once, for every candidate compared with it. */
const blurred = new WeakMap<Ink, Float32Array>()

function sampleAt(d: Float32Array, w: number, h: number, fx: number, fy: number) {
  const x0 = Math.floor(fx)
  const y0 = Math.floor(fy)
  const ax = fx - x0
  const ay = fy - y0
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : d[y * w + x]!)
  return (
    at(x0, y0) * (1 - ax) * (1 - ay) +
    at(x0 + 1, y0) * ax * (1 - ay) +
    at(x0, y0 + 1) * (1 - ax) * ay +
    at(x0 + 1, y0 + 1) * ax * ay
  )
}

function blur(ink: Ink): Float32Array {
  const { width: w, height: h, data } = ink
  const tmp = new Float32Array(w * h)
  const out = new Float32Array(w * h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      tmp[i] = (data[i]! * 2 + (x > 0 ? data[i - 1]! : 0) + (x < w - 1 ? data[i + 1]! : 0)) / 4
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      out[i] = (tmp[i]! * 2 + (y > 0 ? tmp[i - w]! : 0) + (y < h - 1 ? tmp[i + w]! : 0)) / 4
    }
  return out
}

/** The layer placed in the block itself: its centre turned back by the block's tilt about the block's centre. */
export function untilt(place: Placed, m: Measured): Placed {
  if (Math.abs(m.angle) < 0.01) return place
  const a = (m.angle * Math.PI) / 180
  const cx = m.level.width / 2
  const cy = m.level.height / 2
  const px = place.x + place.width / 2 - cx
  const py = place.y + place.height / 2 - cy
  const x = Math.cos(a) * px - Math.sin(a) * py + cx
  const y = Math.sin(a) * px + Math.cos(a) * py + cy
  return { ...place, x: x - place.width / 2, y: y - place.height / 2, rotation: m.angle }
}

function nearestBrandColor(rgb: readonly number[], kit?: Kit): { token: string; value: string } | null {
  if (!kit) return null
  const here = lab(rgb[0]!, rgb[1]!, rgb[2]!)
  let best: { token: string; value: string; d: number } | null = null
  for (const c of kit.colors) {
    const v = c.value
    const d = ciede2000(
      here,
      lab(parseInt(v.slice(1, 3), 16), parseInt(v.slice(3, 5), 16), parseInt(v.slice(5, 7), 16)),
    )
    if (d <= BRAND_COLOR_DELTA && (!best || d < best.d)) best = { ...c, d }
  }
  return best
}

/**
 * The kit's text style the fit matches: set in the chosen brand font, at its weight and slant, with
 * letter spacing within 2% and line height within 0.1 of what was measured. Its values are used.
 */
function brandStyle(kit: Kit, fit: Fitted, lines: number) {
  for (const s of kit.textStyles) {
    const token = 'token' in s.font ? s.font.token : undefined
    const family = 'family' in s.font ? s.font.family : kit.fonts.find((f) => f.token === token)?.family
    if (family !== fit.face.family || s.fontWeight !== fit.face.weight || s.fontStyle !== fit.face.style) continue
    const spacing =
      s.letterSpacing.unit === 'percent' ? s.letterSpacing.value : (s.letterSpacing.value / fit.look.size) * 100
    if (Math.abs(spacing - fit.look.spacing) > 2) continue
    if (lines > 1 && s.lineHeight && Math.abs(s.lineHeight - (fit.look.lineHeight ?? 1.2)) > 0.1) continue
    return { token: s.token, spacing, lineHeight: lines > 1 ? s.lineHeight : undefined }
  }
  return undefined
}

/** Whether a picture is a cut-out: more than 5% of it less than opaque. */
export function hasTransparency(img: { width: number; height: number; data: Uint8Array }) {
  let clear = 0
  for (let i = 0; i < img.width * img.height; i++) if (img.data[i * 4 + 3]! < 250) clear++
  return clear > img.width * img.height * 0.05
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

function median(v: number[]): number {
  if (v.length === 0) return 1
  const s = [...v].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2
}
