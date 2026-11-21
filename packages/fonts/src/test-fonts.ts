// Font files only tests read: a few glyphs of Noto Color Emoji, with the tables Google serves
// (COLRv1 and SVG), so a test can draw colour emoji and copy the file as Google's; and Noto Sans
// as one variable font named Vary Sans, its weight axis 100 to 900, for printable ASCII.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** The emoji it has: 😀 🎉 👍🏽 🇮🇳 ❤️ 1️⃣, and their parts. */
export const TEST_EMOJI = '😀🎉👍🏽🇮🇳❤️1️⃣'

const TEST_FILES_DIR = join(import.meta.dirname, '..', 'test-files')

/** The emoji subset's bytes, a new array each call. */
export function emojiTestFont(): Uint8Array {
  return new Uint8Array(readFileSync(join(TEST_FILES_DIR, 'NotoColorEmoji-subset.ttf')))
}

/** Vary Sans, Noto Sans variable renamed so it is no shipped family: its bytes (`wght` 100–900, default 400), a new array each call. */
export function variableTestFont(): Uint8Array {
  return new Uint8Array(readFileSync(join(TEST_FILES_DIR, 'VarySans-VF-ascii.ttf')))
}

/**
 * A copy of a font file with the style CanvasKit reads from it rewritten: the OS/2 weight class,
 * the italic bits of OS/2 and head, the units per em (which draws every glyph at another size, so
 * faces made from one file draw apart), and a table of `padding` empty bytes, which makes a file of
 * any size that CanvasKit still reads.
 */
export function restyledTestFont(
  source: Uint8Array,
  {
    weight,
    italic,
    unitsPerEm,
    padding = 0,
  }: { weight?: number; italic?: boolean; unitsPerEm?: number; padding?: number },
): Uint8Array {
  const view = new DataView(source.buffer, source.byteOffset, source.byteLength)
  const tables = Array.from({ length: view.getUint16(4) }, (_, i) => {
    const at = 12 + i * 16
    const offset = view.getUint32(at + 8)
    return {
      tag: String.fromCharCode(...source.subarray(at, at + 4)),
      bytes: source.slice(offset, offset + view.getUint32(at + 12)),
    }
  })
  if (padding > 0) tables.push({ tag: 'zpad', bytes: new Uint8Array(padding) })
  tables.sort((a, b) => (a.tag < b.tag ? -1 : 1))
  for (const { tag, bytes } of tables) {
    const table = new DataView(bytes.buffer)
    if (tag === 'OS/2') {
      if (weight !== undefined) table.setUint16(4, weight)
      if (italic !== undefined) table.setUint16(62, italic ? 0x1 : 0x40)
    }
    if (tag === 'head') {
      if (unitsPerEm !== undefined) table.setUint16(18, unitsPerEm)
      if (italic !== undefined) table.setUint16(44, (table.getUint16(44) & ~0x2) | (italic ? 0x2 : 0))
    }
  }
  const start = 12 + tables.length * 16
  const size = tables.reduce((sum, { bytes }) => sum + Math.ceil(bytes.length / 4) * 4, start)
  const out = new Uint8Array(size)
  const outView = new DataView(out.buffer)
  out.set(source.subarray(0, 12))
  outView.setUint16(4, tables.length)
  let offset = start
  tables.forEach(({ tag, bytes }, i) => {
    const at = 12 + i * 16
    for (let k = 0; k < 4; k++) out[at + k] = tag.charCodeAt(k)
    outView.setUint32(at + 8, offset)
    outView.setUint32(at + 12, bytes.length)
    out.set(bytes, offset)
    offset += Math.ceil(bytes.length / 4) * 4
  })
  return out
}
