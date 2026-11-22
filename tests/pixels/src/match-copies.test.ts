// Match copies: a font cut to the characters ads use draws a text of those
// characters with the same pixels as the whole font on the CPU surface, so the text matcher may load the copy.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { beforeAll, describe, expect, it } from 'vitest'

import { coversAll } from '@dazbee/fonts'
import { matchCopy } from '@dazbee/fonts/match-copy'
import { loadFontFiles } from '@dazbee/fonts/node'
import { renderDesign, type ResourceBytes } from '@dazbee/renderer'
import { loadCanvasKit } from '@dazbee/renderer/node'

import { comparePixels, decodePng, encodePng, fixtureResources, OUTPUT_DIR } from './pixels.ts'

const ck = await loadCanvasKit()

/** A sample of each script in a shipped face, of the characters ads use. */
const SAMPLES = [
  {
    file: 'NotoSans-Regular.ttf',
    family: 'Noto Sans',
    text: 'Summer Sale — 50% off, €9.99! Ça coûte peu «Ünïcödé» ΑΩ Привет ₹1,299 ™',
  },
  {
    file: 'NotoSansDevanagari-Regular.ttf',
    family: 'Noto Sans Devanagari',
    text: 'श्री दिवाली सेल क्षमता से ज़्यादा बचत ज्ञ त्र र्‍य हिंदी चाँद दुःख १२३४',
  },
  {
    file: 'NotoNaskhArabic-Regular.ttf',
    family: 'Noto Naskh Arabic',
    text: 'احصل على حذاء الجديد بخصم ٤٠٪ لا إلى سَلام مُحَمَّد كـــبير',
  },
]

/** One text of `family` on white. */
const design = (family: string, text: string) => ({
  meta: { designId: 'match-copy', name: 'Match copy' },
  pages: { p1: { name: 'Page 1', order: 'a0' } },
  frames: {
    sq: {
      pageId: 'p1',
      name: 'Post',
      width: 720,
      height: 260,
      x: 0,
      y: 0,
      fills: [{ type: 'solid', color: '#FFFFFFFF' }],
      order: 'a0',
    },
  },
  nodes: {
    t: {
      type: 'text',
      parentId: 'sq',
      link: 't',
      index: 'a0',
      name: 'Sample',
      props: {
        x: 16,
        y: 16,
        width: 688,
        height: 228,
        boxMode: 'fixed',
        text,
        style: { fontFamily: family, fontSize: 40, color: '#15121AFF' },
      },
    },
  },
})

/** The shipped fonts and images, with the face of `file` swapped for `bytes`. */
function withFace(file: string, bytes: Uint8Array): ResourceBytes {
  return {
    ...fixtureResources(),
    fonts: loadFontFiles().map((face) => (face.file === file ? { ...face, bytes } : face)),
  }
}

beforeAll(() => mkdirSync(OUTPUT_DIR, { recursive: true }))

describe('match copies', () => {
  it.each(SAMPLES)('of $file draw a sample of its script as the whole face does, and are smaller', (sample) => {
    expect(coversAll(sample.text)).toBe(true)
    const whole = loadFontFiles().find((face) => face.file === sample.file)?.bytes ?? new Uint8Array()
    const copy = matchCopy(whole)
    if (!copy) throw new Error(`HarfBuzz made no copy of ${sample.file}`)
    expect(copy.length).toBeLessThan(whole.length)

    const words = design(sample.family, sample.text)
    const fromWhole = decodePng(ck, renderDesign(ck, words, 'sq', withFace(sample.file, whole)).png)
    const fromCopy = decodePng(ck, renderDesign(ck, words, 'sq', withFace(sample.file, copy)).png)
    const { differing, diff } = comparePixels(fromWhole, fromCopy)
    if (differing > 0) writeFileSync(join(OUTPUT_DIR, `match-copy-${sample.file}.diff.png`), encodePng(ck, diff))
    expect(differing).toBe(0)
    // The sample drew ink, so the same pixels are the text's and not an empty frame's.
    expect(fromWhole.pixels.some((channel) => channel < 128)).toBe(true)
  })
})
