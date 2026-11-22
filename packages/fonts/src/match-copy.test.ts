import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

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

  it('makes none of bytes that are not a font', () => {
    expect(matchCopy(new TextEncoder().encode('not a font at all'))).toBeNull()
    expect(matchCopy(new Uint8Array())).toBeNull()
  })
})
