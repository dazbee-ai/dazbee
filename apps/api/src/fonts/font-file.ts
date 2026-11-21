// Reads a font file's family, weight and style from its own tables (#50), so the API can refuse what
// isn't a TrueType or OpenType font and name an upload as its designer did. Drawing stays with
// CanvasKit, which also has to accept the file before it is recorded.
import { loadCanvasKit } from '@dazbee/renderer/node'
import type { FontType } from '@dazbee/schema'

import { previewText } from './preview-text.ts'

export interface FontInfo {
  contentType: FontType
  family: string
  /** The axis default for a variable font. */
  weight: number
  style: 'normal' | 'italic'
  /** A variable font's weight range, whole numbers; none for a font of one weight. */
  weights?: { min: number; max: number }
}

const tag = (view: DataView, at: number) =>
  String.fromCharCode(view.getUint8(at), view.getUint8(at + 1), view.getUint8(at + 2), view.getUint8(at + 3))

/**
 * A preview is the family's name at 32 pixels on a 48 pixel tall strip with its baseline 36 down,
 * every family alike, so the picker shows them at one size on one line; it shows them at half size.
 * What a family draws above or below the strip is cut.
 */
const PREVIEW_SIZE = 32
const PREVIEW_HEIGHT = 48
const PREVIEW_BASELINE = 36
const PREVIEW_MAX_WIDTH = 640

/** The font's family, weight and style, or null when the bytes are not one TrueType or OpenType font. */
export function readFontInfo(bytes: Uint8Array): FontInfo | null {
  if (bytes.length < 12) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const version = view.getUint32(0)
  // TrueType outlines (1.0 or Apple's 'true'), or CFF outlines ('OTTO'). Collections and WOFF are refused.
  const contentType: FontType | null =
    version === 0x00010000 || version === 0x74727565 ? 'font/ttf' : version === 0x4f54544f ? 'font/otf' : null
  if (!contentType) return null
  const directory = tableDirectory(view)
  if (!directory) return null
  const tables = new Map(directory.map((table) => [table.tag, table]))
  const name = tables.get('name')
  if (!name) return null
  const named = names(view, name.at, name.length)
  // The typographic family (16) groups every weight under one name; the legacy one (1) may be "Inter SemiBold".
  const family = named.get(16) ?? named.get(1)
  if (!family) return null
  let weight = 400
  let italic = /italic|oblique/i.test(named.get(17) ?? named.get(2) ?? '')
  const os2 = tables.get('OS/2')
  if (os2 && os2.length >= 64) {
    const weightClass = view.getUint16(os2.at + 4)
    if (weightClass >= 1 && weightClass <= 1000) weight = weightClass
    const selection = view.getUint16(os2.at + 62)
    italic ||= (selection & 0x1) !== 0 || (selection & 0x200) !== 0
  }
  const fvar = tables.get('fvar')
  const axis = fvar ? weightAxis(view, fvar.at, fvar.length) : null
  if (axis) weight = Math.min(axis.max, Math.max(axis.min, axis.at))
  return {
    contentType,
    family,
    weight,
    style: italic ? 'italic' : 'normal',
    ...(axis ? { weights: { min: axis.min, max: axis.max } } : {}),
  }
}

/**
 * The family's name drawn in the face itself, near black on clear, as a PNG: the font picker shows
 * it, so the browser never decodes the font. A face that lacks its name's letters draws a few of
 * the first of `scripts` (ISO 15924 codes) it has instead (`previewText`). Throws when CanvasKit
 * can't read the font.
 */
export async function fontPreview(
  bytes: Uint8Array,
  { family, weight, style }: Pick<FontInfo, 'family' | 'weight' | 'style'>,
  scripts: readonly string[] = [],
): Promise<Uint8Array> {
  const ck = await loadCanvasKit()
  const typeface = ck.Typeface.MakeTypefaceFromData(bytes.slice().buffer)
  if (!typeface) throw new Error("CanvasKit can't read this font")
  const font = new ck.Font(typeface, PREVIEW_SIZE)
  const text = previewText(family, scripts, (chars) => font.getGlyphIDs(chars))
  font.delete()
  typeface.delete()
  const provider = ck.TypefaceFontProvider.Make()
  const fonts = ck.FontCollection.Make()
  try {
    provider.registerFont(bytes, 'preview')
    fonts.setDefaultFontManager(provider)
    const paragraphStyle = new ck.ParagraphStyle({
      textStyle: {
        color: ck.Color(31, 35, 41, 1),
        fontFamilies: ['preview'],
        fontSize: PREVIEW_SIZE,
        fontStyle: {
          weight: { value: weight },
          slant: style === 'italic' ? ck.FontSlant.Italic : ck.FontSlant.Upright,
        },
      },
      maxLines: 1,
      ellipsis: '…',
    })
    const builder = ck.ParagraphBuilder.MakeFromFontCollection(paragraphStyle, fonts)
    builder.addText(text)
    const paragraph = builder.build()
    builder.delete()
    try {
      paragraph.layout(PREVIEW_MAX_WIDTH)
      const width = Math.max(1, Math.min(PREVIEW_MAX_WIDTH, Math.ceil(paragraph.getMaxIntrinsicWidth())))
      const surface = ck.MakeSurface(width, PREVIEW_HEIGHT)
      if (!surface) throw new Error('could not make a surface for the preview')
      try {
        surface.getCanvas().drawParagraph(paragraph, 0, PREVIEW_BASELINE - paragraph.getAlphabeticBaseline())
        const image = surface.makeImageSnapshot()
        const png = image.encodeToBytes()
        image.delete()
        if (!png) throw new Error('could not encode the preview')
        return png
      } finally {
        surface.delete()
      }
    } finally {
      paragraph.delete()
    }
  } finally {
    fonts.delete()
    provider.delete()
  }
}

/**
 * The font without its `SVG ` table, whose glyphs CanvasKit never draws: Google's Noto Color Emoji
 * carries its emoji twice, as COLRv1, which we draw, and as SVG, 20 of its 25 MB. Every other table
 * keeps its bytes, the directory is written anew and the head's checksum adjustment set again. A
 * font with no such table, or bytes that are no font, come back as they are.
 */
export function withoutSvgTable(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 12) return bytes
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const records = tableDirectory(view)
  const kept = records?.filter((r) => r.tag !== 'SVG ')
  if (!records || !kept || kept.length === records.length) return bytes
  const padded = (n: number) => (n + 3) & ~3
  const directory = 12 + kept.length * 16
  const out = new Uint8Array(directory + kept.reduce((sum, r) => sum + padded(r.length), 0))
  const write = new DataView(out.buffer)
  const searchPower = 2 ** Math.floor(Math.log2(kept.length))
  write.setUint32(0, view.getUint32(0))
  write.setUint16(4, kept.length)
  write.setUint16(6, searchPower * 16)
  write.setUint16(8, Math.log2(searchPower))
  write.setUint16(10, kept.length * 16 - searchPower * 16)
  let at = directory
  let head = -1
  kept.forEach((r, i) => {
    out.set(bytes.subarray(r.record, r.record + 8), 12 + i * 16)
    write.setUint32(12 + i * 16 + 8, at)
    write.setUint32(12 + i * 16 + 12, r.length)
    out.set(bytes.subarray(r.at, r.at + r.length), at)
    if (r.tag === 'head' && r.length >= 12) head = at
    at += padded(r.length)
  })
  if (head >= 0) {
    // The head's checksum adjustment makes the whole file sum to 0xB1B0AFBA, counted with it at 0.
    write.setUint32(head + 8, 0)
    write.setUint32(head + 8, (0xb1b0afba - checksum(write)) >>> 0)
  }
  return out
}

/**
 * The font's tables, each with where its record is in the directory and where its bytes are, or
 * null when a record or a table runs past the end of the file.
 */
function tableDirectory(view: DataView): { record: number; tag: string; at: number; length: number }[] | null {
  const tables = []
  for (let i = 0; i < view.getUint16(4); i++) {
    const record = 12 + i * 16
    if (record + 16 > view.byteLength) return null
    const at = view.getUint32(record + 8)
    const length = view.getUint32(record + 12)
    if (at + length > view.byteLength) return null
    tables.push({ record, tag: tag(view, record), at, length })
  }
  return tables
}

/**
 * A variable font's weight axis (`wght` in `fvar`) as whole weights from 1 to 1000, or null when the
 * font has none, it doesn't vary, or its axes run past the table.
 */
function weightAxis(view: DataView, at: number, length: number): { min: number; at: number; max: number } | null {
  if (length < 16) return null
  const axes = at + view.getUint16(at + 4)
  const count = view.getUint16(at + 8)
  const size = view.getUint16(at + 10)
  if (size < 20 || axes + count * size > at + length) return null
  const weight = (fixed: number) => Math.min(1000, Math.max(1, Math.round(view.getInt32(fixed) / 65536)))
  for (let i = 0; i < count; i++) {
    const record = axes + i * size
    if (tag(view, record) !== 'wght') continue
    const [min, def, max] = [weight(record + 4), weight(record + 8), weight(record + 12)]
    return min < max ? { min, at: def, max } : null
  }
  return null
}

/** The name table's strings by name id, Windows English first, then any Windows, then Mac Roman. */
function names(view: DataView, at: number, length: number): Map<number, string> {
  const found = new Map<number, { rank: number; text: string }>()
  if (length < 6) return new Map()
  const count = view.getUint16(at + 2)
  const strings = at + view.getUint16(at + 4)
  for (let i = 0; i < count; i++) {
    const record = at + 6 + i * 12
    if (record + 12 > at + length) break
    const [platform, encoding, language, nameId, size, offset] = [0, 2, 4, 6, 8, 10].map((o) =>
      view.getUint16(record + o),
    ) as [number, number, number, number, number, number]
    if (strings + offset + size > view.byteLength) continue
    const rank =
      platform === 3 && (encoding === 1 || encoding === 10)
        ? language === 0x409
          ? 0
          : 1
        : platform === 1 && encoding === 0
          ? 2
          : -1
    if (rank < 0 || (found.get(nameId)?.rank ?? 9) <= rank) continue
    const text = (platform === 3 ? utf16be(view, strings + offset, size) : latin1(view, strings + offset, size)).trim()
    if (text) found.set(nameId, { rank, text })
  }
  return new Map([...found].map(([id, { text }]) => [id, text]))
}

function utf16be(view: DataView, at: number, length: number) {
  let text = ''
  for (let i = 0; i + 1 < length; i += 2) text += String.fromCharCode(view.getUint16(at + i))
  return text
}

function latin1(view: DataView, at: number, length: number) {
  let text = ''
  for (let i = 0; i < length; i++) text += String.fromCharCode(view.getUint8(at + i))
  return text
}

/** The sum of a font file's 32-bit words, as its checksums count them. */
function checksum(view: DataView) {
  let sum = 0
  for (let at = 0; at < view.byteLength; at += 4) sum = (sum + view.getUint32(at)) >>> 0
  return sum
}
