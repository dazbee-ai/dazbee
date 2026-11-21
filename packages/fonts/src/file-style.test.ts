import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { fileStyle } from './file-style.ts'
import { FONT_FILES_DIR } from './node.ts'
import { restyledTestFont, variableTestFont } from './test-fonts.ts'

const shipped = (file: string) => new Uint8Array(readFileSync(join(FONT_FILES_DIR, file)))
const styleOf = (bytes: Uint8Array) => fileStyle(async (offset, length) => bytes.subarray(offset, offset + length))

describe('fileStyle', () => {
  it("reads a static file's weight and width classes, upright", async () => {
    expect(await styleOf(shipped('NotoSans-Regular.ttf'))).toEqual({ weight: 400, width: 5, slant: 0 })
    expect(await styleOf(shipped('NotoSans-Bold.ttf'))).toEqual({ weight: 700, width: 5, slant: 0 })
  })

  it('reads a file its OS/2 table marks italic as italic, at the weight class it says', async () => {
    const bytes = restyledTestFont(shipped('NotoSans-Regular.ttf'), { weight: 250, italic: true })
    expect(await styleOf(bytes)).toEqual({ weight: 250, width: 5, slant: 1 })
  })

  it("reads a variable file at its weight axis's default", async () => {
    expect(await styleOf(variableTestFont())).toEqual({ weight: 400, width: 5, slant: 0 })
  })
})
