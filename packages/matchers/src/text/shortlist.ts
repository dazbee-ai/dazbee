// The fonts the text matcher tries for a piece: Light's 5 faces nearest the piece's font fingerprint
// among those that draw its script and every character of its words, passing over the novelty faces,
// colour faces and faces that draw no distinct letters the files name; and the brand kit's fonts, each
// family in its 2 faces nearest the fingerprint, or, for a family with no fingerprint (a brand's
// upload), in its regular face nearest the leader's weight and that face's other style.

import type { CanvasKit } from '@dazbee/canvaskit'
import type { CatalogFace, FontStyle } from '@dazbee/fonts'

import { type FontKey, fontKey } from './font-key.ts'
import { type FontSource, type LoadedFaces, loadFaces } from './font-source.ts'
import { type Script, SCRIPT_LETTERS, scriptOf } from './scripts.ts'
import { coversByIndex, similarity, type TextFiles } from './text-files.ts'

/** A face the text matcher tries: its key and what the key names, and the brand kit's token when it is a kit font. */
export interface Candidate extends FontKey {
  /** `family|weight|style`, which a font source gives the face's bytes by. */
  key: string
  brandToken?: string
}

/** What the shortlist reads. */
export interface ShortlistInput {
  ck: CanvasKit
  files: TextFiles
  /** The piece's font fingerprint. */
  fingerprint: Float32Array
  /** The piece's words, lines split by `\n`. */
  words: string
  /** The brand kit's fonts: each token's family. */
  kitFonts: Readonly<Record<string, string>>
  /** The faces Dazbee draws of each kit family with no fingerprint, as the font catalog lists them. */
  kitFaces: readonly CatalogFace[]
  fonts: FontSource
}

/** The faces the text matcher tries for a piece. */
export interface Shortlist {
  /** Light's faces nearest the fingerprint, nearest first. */
  nearest: Candidate[]
  /** The kit's faces, in the kit's order of fonts, each family's nearest first. */
  brand: Candidate[]
  /** Every face to try: the kit's, then the nearest that aren't the kit's. */
  candidates: Candidate[]
  /** Each candidate's similarity to the fingerprint, by key; none for a face with no fingerprint. */
  similarities: ReadonlyMap<string, number>
  /** The bytes of the faces loaded to tell whether they draw the words, by key. */
  loaded: ReadonlyMap<string, Uint8Array | null>
}

/** Which of `rows` have faces that draw the words, in their order. */
type Covers = (rows: readonly number[]) => Promise<boolean[]>

/** How many faces nearest the fingerprint Light tries. */
const SHORTLIST = 5
/** How many faces nearest the fingerprint are checked for the words' characters, for `SHORTLIST` to remain. */
const NEAREST_CHECKED = SHORTLIST * 3
/** How many faces of a kit family with fingerprints are tried. */
const BRAND_FACES = 2

/** The size CanvasKit reads a face's characters at; any size gives the same glyphs. */
const PROBE_SIZE = 20
/** A kit family with no fingerprint is tried near this weight when no face leads the shortlist. */
const REGULAR_WEIGHT = 400

/** The faces to try for a piece of `words` with the fingerprint `fingerprint`. */
export async function shortlist(input: ShortlistInput): Promise<Shortlist> {
  const { files, fingerprint, words } = input
  const script = scriptOf(words)
  const loaded: LoadedFaces = new Map()
  const covers = coverage(input, loaded)
  const allowed = files.keys.flatMap((_, row) =>
    !files.neverListed.has(row) && files.scripts[row]?.has(script) ? [row] : [],
  )
  const near = await firstCovering(
    nearestRows(files, fingerprint, allowed).slice(0, NEAREST_CHECKED),
    SHORTLIST,
    covers,
  )
  const nearest = near.map((row) => candidateOf(files, row))
  const brand = await brandFaces(input, script, nearest[0], covers, loaded)
  const candidates = [...brand, ...nearest.filter((face) => !brand.some((b) => b.key === face.key))]
  const similarities = new Map(
    candidates.flatMap((face) => {
      const row = files.rows.get(face.key)
      return row === undefined ? [] : [[face.key, similarity(files, row, fingerprint)] as const]
    }),
  )
  return { nearest, brand, candidates, similarities, loaded }
}

/**
 * Tells which rows' faces draw every character of the words: by the coverage index, and for words
 * with characters it doesn't hold, by loading the faces, all asked for at once, into `loaded`.
 */
function coverage(input: ShortlistInput, loaded: LoadedFaces): Covers {
  const { files, words } = input
  return async (rows) => {
    const known = rows.map((row) => coversByIndex(files, row, words))
    const unknown = rows.filter((_, i) => known[i] === null).map((row) => files.keys[row] ?? '')
    await loadInto(input, unknown, loaded)
    return rows.map((row, i) => known[i] ?? drawsAll(input.ck, loaded.get(files.keys[row] ?? '') ?? null, words))
  }
}

/** The first `count` of `rows`, in order, whose faces draw the words, checking as few as that takes. */
async function firstCovering(rows: readonly number[], count: number, covers: Covers): Promise<number[]> {
  const kept: number[] = []
  let next = 0
  while (kept.length < count && next < rows.length) {
    const batch = rows.slice(next, next + count - kept.length)
    next += batch.length
    const drawn = await covers(batch)
    batch.forEach((row, i) => {
      if (drawn[i]) kept.push(row)
    })
  }
  return kept
}

/** The rows of `allowed` by their similarity to the fingerprint, nearest first, a tie in the rows' order. */
function nearestRows(files: TextFiles, fingerprint: Float32Array, allowed: readonly number[]): number[] {
  return allowed
    .map((row) => ({ row, similarity: similarity(files, row, fingerprint) }))
    .sort((a, b) => b.similarity - a.similarity)
    .map(({ row }) => row)
}

/** The candidate a row of the files names. */
function candidateOf(files: TextFiles, row: number): Candidate {
  const face = files.faces[row]
  if (!face) throw new Error(`the text matcher's files have no row ${row}`)
  return { key: files.keys[row] ?? '', ...face }
}

/**
 * The kit's faces: each family with fingerprints in its `BRAND_FACES` faces nearest the fingerprint
 * that draw the script and the words, and each without in its regular face nearest the leader's
 * weight and that face's other style, when they draw them. A face under two tokens keeps the first.
 */
async function brandFaces(
  input: ShortlistInput,
  script: Script,
  leader: Candidate | undefined,
  covers: Covers,
  loaded: LoadedFaces,
): Promise<Candidate[]> {
  const { files, fingerprint } = input
  const faces: Candidate[] = []
  for (const [token, family] of Object.entries(input.kitFonts)) {
    const ofFamily = files.keys.flatMap((_, row) => (files.faces[row]?.family === family ? [row] : []))
    const found =
      ofFamily.length > 0
        ? (
            await firstCovering(
              nearestRows(
                files,
                fingerprint,
                ofFamily.filter((row) => files.scripts[row]?.has(script)),
              ),
              BRAND_FACES,
              covers,
            )
          ).map((row) => candidateOf(files, row))
        : await facesWithoutFingerprint(input, family, script, leader?.weight ?? REGULAR_WEIGHT, loaded)
    for (const face of found) if (!faces.some((f) => f.key === face.key)) faces.push({ ...face, brandToken: token })
  }
  return faces
}

/**
 * A kit family with no fingerprint: its regular face nearest `weight`, the lighter on a tie (its
 * italic one when it has no regular face), and the face of its other style at that weight, those
 * of them that draw the script and the words.
 */
async function facesWithoutFingerprint(
  input: ShortlistInput,
  family: string,
  script: Script,
  weight: number,
  loaded: LoadedFaces,
): Promise<Candidate[]> {
  const ofFamily = input.kitFaces.filter((face) => face.family === family)
  const regular = ofFamily.filter((face) => face.style === 'normal')
  const first = nearestWeight(regular.length > 0 ? regular : ofFamily, weight)
  if (!first) return []
  const otherStyle: FontStyle = first.style === 'normal' ? 'italic' : 'normal'
  const other = ofFamily.find((face) => face.style === otherStyle && drawsWeight(face, first.weight))
  const tried = [
    { family, weight: first.weight, style: first.style },
    ...(other ? [{ family, weight: first.weight, style: otherStyle }] : []),
  ].map((face) => ({ key: fontKey(face), ...face }))
  await loadInto(
    input,
    tried.map((face) => face.key),
    loaded,
  )
  const letters = `${input.words}${SCRIPT_LETTERS[script]}`
  return tried.filter((face) => drawsAll(input.ck, loaded.get(face.key) ?? null, letters))
}

/** The face of `faces` that draws a weight nearest `weight`, and that weight; the lighter on a tie. */
function nearestWeight(
  faces: readonly CatalogFace[],
  weight: number,
): { weight: number; style: FontStyle } | undefined {
  let best: { weight: number; style: FontStyle; distance: number } | undefined
  for (const face of faces) {
    const drawn = face.weights ? Math.min(face.weights.max, Math.max(face.weights.min, weight)) : face.weight
    const distance = Math.abs(drawn - weight)
    if (!best || distance < best.distance || (distance === best.distance && drawn < best.weight))
      best = { weight: drawn, style: face.style, distance }
  }
  return best && { weight: best.weight, style: best.style }
}

/** Whether a face draws `weight`: it is its weight, or its range covers it. */
function drawsWeight(face: CatalogFace, weight: number): boolean {
  return face.weights ? face.weights.min <= weight && weight <= face.weights.max : face.weight === weight
}

/** Loads the faces of `keys` not loaded yet into `loaded`, all asked for at once. */
async function loadInto(input: ShortlistInput, keys: readonly string[], loaded: LoadedFaces) {
  const missing = keys.filter((key) => !loaded.has(key))
  if (missing.length === 0) return
  for (const [key, bytes] of await loadFaces(input.fonts, missing, input.words)) loaded.set(key, bytes)
}

/** Whether a face's bytes draw every character of `letters` but white space itself; false for no face. */
function drawsAll(ck: CanvasKit, bytes: Uint8Array | null, letters: string): boolean {
  if (!bytes) return false
  const typeface = ck.Typeface.MakeTypefaceFromData(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  )
  if (!typeface) return false
  const font = new ck.Font(typeface, PROBE_SIZE)
  try {
    return [...font.getGlyphIDs([...new Set(letters.replace(/\s/gu, ''))].join(''))].every((glyph) => glyph !== 0)
  } finally {
    font.delete()
    typeface.delete()
  }
}
