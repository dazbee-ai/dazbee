import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { characterGlyphs, tableDirectory } from './font-tables.ts'
import { MATCH_COPY_VERSION } from './match-characters.ts'
import { matchCopy } from './match-copy.ts'
import { FONT_FILES_DIR } from './node.ts'
import { variableTestFont } from './test-fonts.ts'

/** The tags of a font's tables, from its table directory. */
function tables(font: Uint8Array): string[] {
  const view = new DataView(font.buffer, font.byteOffset, font.byteLength)
  return Array.from({ length: view.getUint16(4) }, (_, i) =>
    String.fromCharCode(...font.subarray(12 + i * 16, 16 + i * 16)),
  ).sort()
}

/** The characters a font's character map gives a glyph. */
function charactersOf(font: Uint8Array): Set<number> {
  const view = new DataView(font.buffer, font.byteOffset, font.byteLength)
  const cmap = tableDirectory(view)?.find((table) => table.tag === 'cmap')
  return new Set(cmap ? characterGlyphs(view, cmap.at, cmap.length).keys() : [])
}

describe('matchCopy', () => {
  it('cuts a font smaller, keeping every table, its variation axes and layout features among them', () => {
    const arabic = new Uint8Array(readFileSync(join(FONT_FILES_DIR, 'NotoNaskhArabic-Regular.ttf')))
    const copy = matchCopy(arabic)
    expect(copy?.length).toBeLessThan(arabic.length)
    expect(tables(copy ?? new Uint8Array())).toEqual(tables(arabic))
    expect(tables(arabic)).toEqual(expect.arrayContaining(['GPOS', 'GSUB']))

    const variable = variableTestFont()
    expect(tables(matchCopy(variable) ?? new Uint8Array())).toEqual(tables(variable))
    expect(tables(variable)).toEqual(expect.arrayContaining(['fvar', 'gvar']))
  })

  it('cuts a font to other characters when given them, mapping those and no others of the ones ads use', () => {
    const latin = new Uint8Array(readFileSync(join(FONT_FILES_DIR, 'NotoSans-Regular.ttf')))
    const whole = matchCopy(latin)
    const cut = matchCopy(
      latin,
      [...'Sale '].map((char) => char.codePointAt(0) ?? 0),
    )
    expect(cut?.length).toBeLessThan(whole?.length ?? 0)
    expect(tables(cut ?? new Uint8Array())).toEqual(tables(latin))
    const mapped = charactersOf(cut ?? new Uint8Array())
    expect([...'Sale '].every((char) => mapped.has(char.codePointAt(0) ?? 0))).toBe(true)
    expect(mapped.has('Z'.codePointAt(0) ?? 0)).toBe(false)
  })

  it('makes none of bytes that are not a font', () => {
    expect(matchCopy(new TextEncoder().encode('not a font at all'))).toBeNull()
    expect(matchCopy(new Uint8Array())).toBeNull()
  })
})

describe('MATCH_COPY_VERSION', () => {
  it('names the harfbuzzjs the copies are made with, so a new one raises the version', () => {
    const pinned = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>
    }
    expect({ version: MATCH_COPY_VERSION, harfbuzzjs: pinned.dependencies.harfbuzzjs }).toEqual({
      version: 1,
      harfbuzzjs: '1.6.4',
    })
  })
})
