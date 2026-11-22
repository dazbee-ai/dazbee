// Cuts the faces Light's test draws and shortlists from a checkout of google/fonts at `GOOGLE_FONTS`'s
// commit, each to the test's characters, into `fixtures/text-light/fonts/`, named by key in
// `fonts.json`: each piece of `pieces.json` and the noise piece is drawn in its cut face, read and
// shortlisted, and every face listed is cut too.
//   node scripts/cut-light-fonts.ts <google/fonts checkout>
// A piece added or drawn otherwise needs the faces cut again.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { GOOGLE_FONTS, googleFaces } from '@dazbee/fonts/google'
import { matchCopy } from '@dazbee/fonts/match-copy'
import type { Pixels } from '@dazbee/renderer'
import { loadCanvasKit } from '@dazbee/renderer/node'

import { pieceFingerprint } from '../src/text/fingerprint.ts'
import { faceOfKey, parseFontKey } from '../src/text/font-key.ts'
import { readPiece } from '../src/text/read-piece.ts'
import { shortlist } from '../src/text/shortlist.ts'
import { textMatcherFiles } from '../src/text/test-text-files.ts'
import { drawText, LIGHT_FIXTURES, lightDrawings, NOISE_WORDS, noisePiece } from '../src/text/test-text-pieces.ts'

const [checkout] = process.argv.slice(2)
if (!checkout) {
  console.error('Usage: node scripts/cut-light-fonts.ts <google/fonts checkout>')
  process.exit(1)
}
const drawings = lightDrawings()
const characters = [...new Set([...drawings.map((d) => d.words).join(''), ...NOISE_WORDS, ' '])].map(
  (char) => char.codePointAt(0) ?? 0,
)
const ck = await loadCanvasKit()
const { files, model } = await textMatcherFiles()
/** Each face's file in the checkout, by key, and each file cut, by its name. */
const fileOfKey = new Map<string, string>()
const cut = new Map<string, Uint8Array>()
const fonts = { face: async (key: string) => cutFace(key) }

const pieces: { words: string; pixels: Pixels }[] = [{ words: NOISE_WORDS, pixels: noisePiece() }]
for (const drawing of drawings) {
  const face = parseFontKey(drawing.key)
  if (!face) throw new Error(`${drawing.key} of ${drawing.id} is not a font key`)
  pieces.push({
    words: drawing.words,
    pixels: drawText(ck, { ...drawing, ...face }, [{ family: face.family, bytes: cutFace(drawing.key) }]),
  })
}
for (const { words, pixels } of pieces) {
  const { work } = readPiece({ pixels, words })
  const fingerprint = await pieceFingerprint(model, files, work.level, work.lines)
  const listed = await shortlist({ ck, files, fingerprint, words, kitFonts: {}, kitFaces: [], fonts })
  for (const { key } of listed.candidates) cutFace(key)
}
await model.release()

const dir = join(LIGHT_FIXTURES, 'fonts')
rmSync(dir, { recursive: true, force: true })
mkdirSync(dir, { recursive: true })
for (const [name, bytes] of cut) {
  writeFileSync(join(dir, name), bytes)
  console.log(`${name}: ${bytes.length} bytes`)
}
const names = Object.fromEntries([...fileOfKey].sort(([a], [b]) => a.localeCompare(b)))
writeFileSync(join(LIGHT_FIXTURES, 'fonts.json'), `${JSON.stringify(names, null, 2)}\n`)

/** The file of the checkout that draws a key, cut to the test's characters, each file cut once. */
function cutFace(key: string): Uint8Array {
  const parsed = parseFontKey(key)
  const family = parsed && GOOGLE_FONTS.find((f) => f.family === parsed.family)
  const found = parsed && family ? faceOfKey(parsed, googleFaces(family)) : null
  if (!family || !found) throw new Error(`no face of the catalog draws ${key}`)
  const name = found.face.file.replace(/[^\w.-]/g, '')
  fileOfKey.set(key, name)
  const known = cut.get(name)
  if (known) return known
  const bytes = matchCopy(new Uint8Array(readFileSync(join(checkout ?? '', family.path, found.face.file))), characters)
  if (!bytes) throw new Error(`HarfBuzz couldn't cut ${key}`)
  cut.set(name, bytes)
  return bytes
}
