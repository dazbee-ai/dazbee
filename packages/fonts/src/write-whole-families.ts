// Writes `whole-families.json`: the Google families whose files CanvasKit reads in a way
// `facesToLoad` doesn't foresee, so every face of one is loaded. It reads the style tables of every
// file of `google-fonts.json` from google/fonts at the list's commit, a few bytes at a time, and
// checks each family with `missesDrawnFace`. Run it whenever `google-fonts` writes a new list:
// `pnpm --filter @dazbee/fonts whole-families`.
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { type CatalogFace, missesDrawnFace } from './face-match.ts'
import { fileStyle, type ReadBytes } from './file-style.ts'
import { GOOGLE_FONTS, GOOGLE_FONTS_COMMIT, googleFileUrl } from './google.ts'
import { variesInWeight } from './google-metadata.ts'

/** How many families are read at once. */
const AT_ONCE = 16
const OUT = join(import.meta.dirname, 'whole-families.json')

let done = 0
const results = await inBatches(GOOGLE_FONTS, async (family) => {
  // The faces as the import records them, in the order the API gives them: upright by weight, then italic.
  const files = [...family.faces].sort((a, b) =>
    a.style === b.style ? a.weight - b.weight : a.style === 'normal' ? -1 : 1,
  )
  const read = await Promise.all(
    files.map(async (file) => {
      const url = googleFileUrl(family, file)
      const style = await fileStyle(rangeReader(url))
      const range = variesInWeight(file.file) ? await weightRange(rangeReader(url)) : null
      const face: CatalogFace = {
        family: family.family,
        weight: range ? Math.min(range.max, Math.max(range.min, file.weight)) : file.weight,
        weights: range ?? undefined,
        style: file.style,
        source: 'google',
      }
      return { face, style }
    }),
  )
  done++
  if (done % 200 === 0) console.log(`${done} of ${GOOGLE_FONTS.length} families read`)
  return {
    family: family.family,
    whole: missesDrawnFace(
      read.map((one) => one.face),
      read.map((one) => one.style),
    ),
  }
})
const whole = results.filter((result) => result.whole).map((result) => result.family)
await writeFile(OUT, `${JSON.stringify({ commit: GOOGLE_FONTS_COMMIT, families: whole }, null, 2)}\n`)
console.log(`${whole.length} of ${GOOGLE_FONTS.length} families load whole: ${whole.join(', ')}`)

/** Reads byte ranges of the file at `url`, each tried up to five times. */
function rangeReader(url: string): ReadBytes {
  return async (offset, length) => {
    for (let attempt = 1; ; attempt++) {
      const response = await fetch(url, { headers: { range: `bytes=${offset}-${offset + length - 1}` } }).catch(
        (reason: unknown) => reason as Error,
      )
      if (response instanceof Response && response.status === 206) return new Uint8Array(await response.arrayBuffer())
      if (attempt === 5)
        throw new Error(`${url} answered ${response instanceof Response ? response.status : response.message}`)
      await new Promise((resolve) => setTimeout(resolve, attempt * 1000))
    }
  }
}

/** A variable file's weight range, whole numbers, as the API's import records it. */
async function weightRange(read: ReadBytes): Promise<{ min: number; max: number } | null> {
  const header = new DataView((await read(0, 12)).buffer)
  const records = await read(12, header.getUint16(4) * 16)
  const view = new DataView(records.buffer)
  for (let at = 0; at < records.length; at += 16) {
    if (String.fromCharCode(...records.subarray(at, at + 4)) !== 'fvar') continue
    const fvar = new DataView((await read(view.getUint32(at + 8), view.getUint32(at + 12))).buffer)
    const weight = (fixed: number) => Math.min(1000, Math.max(1, Math.round(fvar.getInt32(fixed) / 65536)))
    for (let i = 0; i < fvar.getUint16(8); i++) {
      const axis = fvar.getUint16(4) + i * fvar.getUint16(10)
      if (String.fromCharCode(...[0, 1, 2, 3].map((k) => fvar.getUint8(axis + k))) !== 'wght') continue
      const [min, max] = [weight(axis + 4), weight(axis + 12)]
      return min < max ? { min, max } : null
    }
  }
  return null
}

/** Runs `work` on every item, `AT_ONCE` at a time, keeping the items' order. */
async function inBatches<T, R>(items: readonly T[], work: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = []
  for (let i = 0; i < items.length; i += AT_ONCE)
    out.push(...(await Promise.all(items.slice(i, i + AT_ONCE).map(work))))
  return out
}
