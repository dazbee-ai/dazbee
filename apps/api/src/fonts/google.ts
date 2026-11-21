// Google Fonts families copied into our storage from google/fonts, shared by every workspace.
import { createHash } from 'node:crypto'

import { and, eq } from 'drizzle-orm'

import { type Db, fontFaces, newId } from '@dazbee/db'
import { type GoogleFamily, type GoogleFile, variesInWeight } from '@dazbee/fonts'
import { googleFileUrl } from '@dazbee/fonts/google'
import type { Storage } from '@dazbee/storage'

import { GOOGLE_SOURCES, googleFontKey, googleSourceKey, previewKey } from '../storage-keys.ts'
import { fontPreview, readFontInfo, withoutSvgTable } from './font-file.ts'
import { replaceFace } from './fonts.ts'

/**
 * What copying one family did: the files copied anew and the bytes stored of them, the files
 * copied before, and why the family stopped, if it did.
 */
export interface FamilyCopy {
  copied: number
  bytes: number
  upToDate: number
  failed: string | null
}

/** How many times a file is fetched before the family is given up on. */
const ATTEMPTS = 3

/**
 * Each file of google/fonts copied before, by its git blob: the SHA-256 it was stored under. A run
 * reads them once, so a family copied before is left as it is without fetching a byte.
 */
export async function copiedSources(storage: Storage): Promise<Map<string, string>> {
  const copied = new Map<string, string>()
  for (const key of await storage.list(GOOGLE_SOURCES)) {
    const [blob, sha256] = key.slice(GOOGLE_SOURCES.length).split('/')
    if (blob && sha256) copied.set(blob, sha256)
  }
  return copied
}

/**
 * Copies one Google Fonts family into our storage: each file the list names, from google/fonts at
 * the list's commit, checked against its git blob, without the SVG glyphs CanvasKit never draws,
 * with a preview, and recorded as the list names it (a variable file with its weight range). A
 * file copied before whose face is still recorded is left as it is, so a run stopped part way
 * picks up where it stopped. A file that can't be fetched or read stops the family, the files
 * before it kept, and says why.
 */
export async function importGoogleFamily(
  db: Db,
  storage: Storage,
  family: GoogleFamily,
  {
    copied,
    get = fetch,
    wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  }: { copied: Map<string, string>; get?: typeof fetch; wait?: (ms: number) => Promise<void> },
): Promise<FamilyCopy> {
  const have = await db
    .select({ style: fontFaces.style, sha256: fontFaces.sha256 })
    .from(fontFaces)
    .where(and(eq(fontFaces.source, 'google'), eq(fontFaces.family, family.family)))
  const done: FamilyCopy = { copied: 0, bytes: 0, upToDate: 0, failed: null }
  for (const face of family.faces) {
    const stored = copied.get(face.blob)
    if (stored && have.some((row) => row.style === face.style && row.sha256 === stored)) {
      done.upToDate++
      continue
    }
    try {
      done.bytes += await copyFile(db, storage, family, face, { get, wait }, copied)
      done.copied++
    } catch (reason) {
      done.failed = `${face.file}: ${reason instanceof Error ? reason.message : String(reason)}`
      break
    }
  }
  return done
}

/** Copies one file of the family and records its face; gives back how many bytes it stored. */
async function copyFile(
  db: Db,
  storage: Storage,
  family: GoogleFamily,
  face: GoogleFile,
  { get, wait }: { get: typeof fetch; wait: (ms: number) => Promise<void> },
  copied: Map<string, string>,
): Promise<number> {
  const bytes = withoutSvgTable(await fetchFile(family, face, get, wait))
  const info = readFontInfo(bytes)
  if (!info) throw new Error('it is not a TrueType or OpenType font')
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  // A file Google names variable in its weight is recorded with its own range; every file at the
  // weight Google names it by (Regular for a variable one, within its range), which its preview shows.
  const range = variesInWeight(face.file) ? info.weights : undefined
  const weight = range ? Math.min(range.max, Math.max(range.min, face.weight)) : face.weight
  const key = googleFontKey(sha256)
  const preview = await fontPreview(bytes, { family: family.family, weight, style: face.style }, family.scripts)
  await storage.put(key, bytes, 'font/ttf')
  await storage.put(previewKey(key), preview, 'image/png')
  const replaced = await replaceFace(db, {
    id: newId(),
    workspaceId: null,
    brandId: null,
    source: 'google',
    family: family.family,
    weight,
    weightMin: range?.min ?? null,
    weightMax: range?.max ?? null,
    style: face.style,
    category: family.category,
    sha256,
    byteSize: bytes.length,
  })
  // Noted last, so a run stopped before this point copies the file again.
  await storage.put(googleSourceKey(face.blob, sha256), new Uint8Array(), 'application/octet-stream')
  copied.set(face.blob, sha256)
  await removeUnused(db, storage, replaced, copied)
  return bytes.length
}

/**
 * Deletes from storage the files of the Google faces just replaced that no Google face holds any
 * more, with their previews and the notes that they were copied, so a new commit's files take the
 * place of the old ones rather than adding to them.
 */
async function removeUnused(db: Db, storage: Storage, replaced: string[], copied: Map<string, string>) {
  for (const sha256 of new Set(replaced)) {
    const [held] = await db
      .select({ id: fontFaces.id })
      .from(fontFaces)
      .where(and(eq(fontFaces.source, 'google'), eq(fontFaces.sha256, sha256)))
      .limit(1)
    if (held) continue
    await storage.delete(googleFontKey(sha256))
    await storage.delete(previewKey(googleFontKey(sha256)))
    for (const [blob, stored] of copied)
      if (stored === sha256) {
        await storage.delete(googleSourceKey(blob, sha256))
        copied.delete(blob)
      }
  }
}

/**
 * A file's bytes from google/fonts, tried `ATTEMPTS` times, refused unless they are the list's git
 * blob. A connection that drops is tried again soon; a busy answer (429 or 5xx) after a longer wait.
 */
async function fetchFile(
  family: GoogleFamily,
  face: GoogleFile,
  get: typeof fetch,
  wait: (ms: number) => Promise<void>,
): Promise<Uint8Array> {
  const url = googleFileUrl(family, face)
  let problem = ''
  let busy = false
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    if (attempt > 1) await wait((busy ? 15_000 : 1_000) * 2 ** (attempt - 2))
    try {
      const response = await get(url)
      busy = response.status === 429 || response.status >= 500
      if (!response.ok) problem = `google/fonts answered ${response.status}`
      else {
        const bytes = new Uint8Array(await response.arrayBuffer())
        if (gitBlob(bytes) === face.blob) return bytes
        problem = `its ${bytes.length} bytes are not google/fonts' file`
      }
    } catch (reason) {
      busy = false
      problem = reason instanceof Error ? reason.message : String(reason)
    }
  }
  throw new Error(problem)
}

/** Bytes' git blob SHA-1, as git names a file's content. */
function gitBlob(bytes: Uint8Array): string {
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')
}
