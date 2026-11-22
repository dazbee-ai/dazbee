import { afterAll, describe, expect, it } from 'vitest'

import type { CatalogFace } from '@dazbee/fonts'
import { loadFontFiles } from '@dazbee/fonts/node'
import { loadCanvasKit } from '@dazbee/renderer/node'

import { pieceFingerprint } from './fingerprint.ts'
import type { FontSource } from './font-source.ts'
import { readPiece } from './read-piece.ts'
import { shortlist, type ShortlistInput } from './shortlist.ts'
import { textMatcherFiles } from './test-text-files.ts'
import { type ShortlistPiece, shortlistPieces } from './test-text-pieces.ts'
import { coversByIndex } from './text-files.ts'

const ck = await loadCanvasKit()
const { files, model } = await textMatcherFiles()
const pieces = shortlistPieces(ck)

/**
 * How many pieces of each script have their drawn face among Light's 5 in the text prototype
 * (`text-match-prototype` 8596833, its gallery the release's fingerprints), run once on these pieces:
 * 11 of the 12. Its fingerprints and shortlists were the same as these, number for number.
 */
const PROTOTYPE_FOUND = { latin: 6, arabic: 2, devanagari: 3 }

/** A font source that is never asked: words of the characters ads use need no face loaded. */
const NO_FONTS: FontSource = {
  face: () => Promise.reject(new Error('no face should be loaded')),
}

/** A shipped face's bytes. */
const shipped = (file: string) => loadFontFiles().find((face) => face.file === file)?.bytes ?? new Uint8Array()

/** The fingerprint of a piece as the matcher works it. */
async function fingerprintOf(piece: ShortlistPiece): Promise<Float32Array> {
  const { work } = readPiece({ pixels: piece.pixels, words: piece.words })
  return pieceFingerprint(model, files, work.level, work.lines)
}

/**
 * A piece's shortlist with no kit and no face loaded, unless the input says otherwise, read and
 * listed twice, which must give the same faces.
 */
async function shortlistOf(piece: ShortlistPiece, input: Partial<ShortlistInput> = {}) {
  const once = async () =>
    shortlist({
      ck,
      files,
      fingerprint: await fingerprintOf(piece),
      words: piece.words,
      kitFonts: {},
      kitFaces: [],
      fonts: NO_FONTS,
      ...input,
    })
  const first = await once()
  const second = await once()
  expect(second.candidates).toEqual(first.candidates)
  expect(second.nearest).toEqual(first.nearest)
  return first
}

/** The shortlist's piece of `id`. */
function piece(id: string): ShortlistPiece {
  const found = pieces.find((p) => p.id === id)
  if (!found) throw new Error(`no piece ${id}`)
  return found
}

afterAll(() => model.release())

describe('shortlist', () => {
  it.each(Object.entries(PROTOTYPE_FOUND))(
    'has the drawn face of the %s pieces in their 5 as often as the prototype',
    async (script, prototypeFound) => {
      let found = 0
      for (const p of pieces.filter(({ id }) => id.startsWith(`${script}-`))) {
        const { nearest } = await shortlistOf(p)
        expect(nearest).toHaveLength(5)
        if (nearest.some((face) => face.key === p.key)) found++
      }
      expect(found).toBeGreaterThanOrEqual(prototypeFound)
    },
  )

  it('never shortlists a face missing a character of the words', async () => {
    const latin = piece('latin-1')
    const words = `${latin.words} ₹`
    const plain = await shortlistOf(latin)
    const withRupee = await shortlistOf(latin, { words })
    expect(plain.nearest.map((face) => face.key)).toContain('Heebo|700|normal')
    expect(withRupee.nearest.map((face) => face.key)).not.toContain('Heebo|700|normal')
    expect(withRupee.nearest).toHaveLength(5)
    for (const face of withRupee.candidates)
      expect(coversByIndex(files, files.rows.get(face.key) ?? -1, words)).toBe(true)
  })

  it('loads whole faces to check characters the coverage index does not hold, all at once', async () => {
    const latin = piece('latin-1')
    const asked: { key: string; copy: boolean }[] = []
    // Noto Sans stands in for Roboto's faces and draws ⅓, which the index doesn't hold; no other face is given.
    const fonts: FontSource = {
      face: (key, copy) => {
        asked.push({ key, copy })
        return Promise.resolve(key.startsWith('Roboto|') ? shipped('NotoSans-Bold.ttf') : null)
      },
    }
    const list = await shortlistOf(latin, { words: `${latin.words} ⅓`, fonts })
    expect(list.nearest.length).toBeGreaterThan(0)
    for (const face of list.nearest) expect(face.family).toBe('Roboto')
    expect(asked.every(({ copy }) => !copy)).toBe(true)
    // Each face asked for once a listing, of the 15 nearest at most.
    const keys = new Set(asked.map(({ key }) => key))
    expect(asked).toHaveLength(keys.size * 2)
    expect(keys.size).toBeLessThanOrEqual(15)
  })

  it('adds a kit family with fingerprints in its 2 faces nearest the piece, bound to its token, before the rest', async () => {
    const list = await shortlistOf(piece('latin-1'), { kitFonts: { heading: 'Lobster', body: 'Lobster' } })
    expect(list.brand).toEqual([
      { key: 'Lobster|400|normal', family: 'Lobster', weight: 400, style: 'normal', brandToken: 'heading' },
    ])
    expect(list.candidates[0]).toEqual(list.brand[0])
    expect(list.candidates.slice(1)).toEqual(list.nearest)
    expect(list.similarities.get('Lobster|400|normal')).toBeTypeOf('number')

    const two = await shortlistOf(piece('latin-1'), { kitFonts: { heading: 'Montserrat' } })
    expect(two.brand.map((face) => face.family)).toEqual(['Montserrat', 'Montserrat'])
  })

  it('adds a kit family with no fingerprint in its regular face nearest the leader’s weight and that face’s other style', async () => {
    const latin = piece('latin-1')
    const kitFaces: CatalogFace[] = [
      { family: 'Brand Grotesk', weight: 400, style: 'normal' },
      { family: 'Brand Grotesk', weight: 800, style: 'normal' },
      { family: 'Brand Grotesk', weight: 100, weights: { min: 100, max: 900 }, style: 'italic' },
    ]
    const asked: string[] = []
    const fonts: FontSource = {
      face: (key) => {
        asked.push(key)
        return Promise.resolve(shipped('NotoSans-Bold.ttf'))
      },
    }
    const list = await shortlistOf(latin, { kitFonts: { body: 'Brand Grotesk' }, kitFaces, fonts })
    expect(list.nearest[0]?.weight).toBe(700)
    expect(list.brand).toEqual([
      { key: 'Brand Grotesk|800|normal', family: 'Brand Grotesk', weight: 800, style: 'normal', brandToken: 'body' },
      { key: 'Brand Grotesk|800|italic', family: 'Brand Grotesk', weight: 800, style: 'italic', brandToken: 'body' },
    ])
    expect(list.similarities.has('Brand Grotesk|800|normal')).toBe(false)
    // Once a listing.
    expect(asked.sort()).toEqual([
      'Brand Grotesk|800|italic',
      'Brand Grotesk|800|italic',
      'Brand Grotesk|800|normal',
      'Brand Grotesk|800|normal',
    ])

    // A face that doesn't draw the piece's script never joins.
    const arabic = await shortlistOf(piece('arabic-1'), { kitFonts: { body: 'Brand Grotesk' }, kitFaces, fonts })
    expect(arabic.brand).toEqual([])
  })
})
