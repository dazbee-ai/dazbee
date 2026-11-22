import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { loadFontFiles } from '@dazbee/fonts/node'
import { loadCanvasKit } from '@dazbee/renderer/node'

import { parseFontKey } from '../src/text/font-key.ts'
import type { Script } from '../src/text/scripts.ts'
import { drawsLetters, drawsOnlyCapitals, letterShapes } from './letter-shapes.ts'

const ck = await loadCanvasKit()
const FIXTURES = join(import.meta.dirname, '..', 'fixtures', 'letter-shapes')

/** A whole face's bytes: a fixture's, or a shipped face's. */
const FACES: Record<string, () => Uint8Array> = {
  'Wavefont|600|normal': () => fixture('Wavefont.ttf'),
  'Linefont|600|normal': () => fixture('Linefont.ttf'),
  'Libre Barcode 128|400|normal': () => fixture('LibreBarcode128-Regular.ttf'),
  'Six Caps|400|normal': () => fixture('SixCaps.ttf'),
  'Noto Sans|400|normal': () => shipped('NotoSans-Regular.ttf'),
  'Noto Sans|800|normal': () => shipped('NotoSans-ExtraBold.ttf'),
  'Noto Naskh Arabic|400|normal': () => shipped('NotoNaskhArabic-Regular.ttf'),
  'Noto Sans Devanagari|400|normal': () => shipped('NotoSansDevanagari-Regular.ttf'),
}

/** How the face of `key` draws letters, measured on `script`'s letters. */
function shapesOf(key: string, script: Script = 'latin') {
  const face = parseFontKey(key)
  const bytes = FACES[key]?.()
  if (!face || !bytes) throw new Error(`no face for ${key}`)
  const typeface = ck.Typeface.MakeTypefaceFromData(bytes.slice().buffer)
  if (!typeface) throw new Error(`CanvasKit can't read ${key}`)
  const font = new ck.Font(typeface, 20)
  try {
    return letterShapes(ck, bytes, face, script, (character) => font.getGlyphIDs(character)[0] !== 0)
  } finally {
    font.delete()
    typeface.delete()
  }
}

/** A fixture face's bytes. */
function fixture(file: string): Uint8Array {
  return new Uint8Array(readFileSync(join(FIXTURES, file)))
}

/** A shipped face's bytes. */
function shipped(file: string): Uint8Array {
  const found = loadFontFiles().find((face) => face.file === file)
  if (!found) throw new Error(`${file} is not shipped`)
  return found.bytes
}

describe('letterShapes', () => {
  it.each(['Wavefont|600|normal', 'Linefont|600|normal', 'Libre Barcode 128|400|normal'])(
    'finds that %s draws a pattern rather than letters',
    (key) => {
      expect(drawsLetters(shapesOf(key))).toBe(false)
    },
  )

  it.each(['Noto Sans|400|normal', 'Noto Sans|800|normal'])('finds that %s draws letters in both cases', (key) => {
    const shapes = shapesOf(key)
    expect(drawsLetters(shapes)).toBe(true)
    expect(drawsOnlyCapitals(shapes)).toBe(false)
  })

  it.each([
    ['Noto Naskh Arabic|400|normal', 'arabic'],
    ['Noto Sans Devanagari|400|normal', 'devanagari'],
  ] as const)('finds that %s draws the letters of its script', (key, script) => {
    const shapes = shapesOf(key, script)
    expect(shapes.measured).toBeGreaterThan(20)
    expect(drawsLetters(shapes)).toBe(true)
  })

  it('finds that Six Caps draws letters, and its lowercase letters as capitals', () => {
    const shapes = shapesOf('Six Caps|400|normal')
    expect(drawsLetters(shapes)).toBe(true)
    expect(drawsOnlyCapitals(shapes)).toBe(true)
  })

  it('gives the same measure twice', () => {
    expect(shapesOf('Noto Sans|400|normal')).toEqual(shapesOf('Noto Sans|400|normal'))
  })
})
