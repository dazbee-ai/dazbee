// The font catalog (#50): Google Fonts copied into our storage, shared by every workspace, and the
// fonts each brand uploads, its own. A brand's upload of a family Google also has is the one that
// brand sees. Every file is read back from our storage, by the editor and by Node renders alike.
// The Google part is one list for every brand, built once for each set of Google faces and named by
// the hash of its bytes.
import { createHash } from 'node:crypto'

import { and, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm'

import { type Db, fontFaces, newId } from '@dazbee/db'
import { facesToLoad, type FontUse, type GoogleFamily } from '@dazbee/fonts'
import { GOOGLE_FONTS } from '@dazbee/fonts/google'
import {
  byCodeUnits,
  type FontCatalogParts,
  type FontFace,
  type FontFamily,
  type FontLink,
  type FontUploadTicket,
  googleFontListPath,
  type StartFontUpload,
} from '@dazbee/schema'
import type { Storage } from '@dazbee/storage'

import { checkUpload, googleFontKey, previewKey, signedLink, signedUpload, uploadedFontKey } from '../storage-keys.ts'
import { fontPreview, readFontInfo } from './font-file.ts'

export class InvalidFont extends Error {}

/** The Google list: its bytes, JSON, and the hash of those bytes, which names its address. */
export interface GoogleFontList {
  hash: string
  bytes: Uint8Array
}

type Row = typeof fontFaces.$inferSelect

const keyOf = (row: Row) => (row.workspaceId ? uploadedFontKey(row.workspaceId, row.sha256) : googleFontKey(row.sha256))
const toFace = (row: Row): FontFace => ({
  id: row.id,
  family: row.family,
  weight: row.weight,
  ...(row.weightMin !== null && row.weightMax !== null ? { weights: { min: row.weightMin, max: row.weightMax } } : {}),
  style: row.style,
  source: row.source,
  byteSize: row.byteSize,
})
const byFace = (a: Row, b: Row) => (a.style === b.style ? a.weight - b.weight : a.style === 'normal' ? -1 : 1)

/** What a brand can use: every Google face and the brand's own uploads. */
const visibleTo = (workspaceId: string, brandId: string) =>
  or(eq(fontFaces.source, 'google'), and(eq(fontFaces.workspaceId, workspaceId), eq(fontFaces.brandId, brandId)))

/** The Google Fonts families by name, once looked up. */
let googleByName: ReadonlyMap<string, GoogleFamily> | undefined

/** The Google list last built or being built, with the fingerprint of the Google faces it is built from. */
let builtList: { fingerprint: string; list: Promise<GoogleFontList> } | undefined

/**
 * The catalog a brand picks from, families by name; a Google family with its place in Google
 * Fonts' popularity order and its scripts, from `GOOGLE_FONTS`. Only the named families, when some are named.
 */
export async function listFonts(
  db: Db,
  workspaceId: string,
  brandId: string,
  names?: readonly string[],
): Promise<FontFamily[]> {
  if (names?.length === 0) return []
  const rows = await db
    .select()
    .from(fontFaces)
    .where(and(visibleTo(workspaceId, brandId), names ? inArray(fontFaces.family, [...names]) : undefined))
  return toFamilies(rows)
}

/** The brand's catalog in two parts: the address of the Google list, the same for every brand, and its uploads. */
export async function fontCatalogParts(db: Db, workspaceId: string, brandId: string): Promise<FontCatalogParts> {
  const [list, uploads] = await Promise.all([
    googleFontList(db),
    db
      .select()
      .from(fontFaces)
      .where(and(eq(fontFaces.workspaceId, workspaceId), eq(fontFaces.brandId, brandId))),
  ])
  return { google: googleFontListPath(list.hash), uploads: toFamilies(uploads) }
}

/**
 * The Google families, every face of each, as every brand sees them where it has no upload of the family: built
 * again only once the Google faces are others, which a fingerprint of their ids tells, since a face is never changed,
 * only added or removed. The same faces always give the same bytes, so every server names the same hash.
 */
export async function googleFontList(db: Db): Promise<GoogleFontList> {
  const [stored] = await db
    .select({
      fingerprint: sql<string>`md5(coalesce(string_agg(${fontFaces.id}, ',' order by ${fontFaces.id} collate "C"), ''))`,
    })
    .from(fontFaces)
    .where(eq(fontFaces.source, 'google'))
  const fingerprint = stored?.fingerprint ?? ''
  if (builtList?.fingerprint === fingerprint) return builtList.list
  // Asks at the same moment wait for the one build.
  const list = buildGoogleFontList(db)
  builtList = { fingerprint, list }
  list.catch(() => {
    if (builtList?.list === list) builtList = undefined
  })
  return list
}

/** The Google list last built, without asking the database; none before the first is built. */
export async function lastGoogleFontList(): Promise<GoogleFontList | undefined> {
  return builtList?.list.catch(() => undefined)
}

/**
 * The Google list of the faces stored now, by id, so the same faces always come in the same order. A face added
 * between the fingerprint and this read is in the list already; the next fingerprint builds it again.
 */
async function buildGoogleFontList(db: Db): Promise<GoogleFontList> {
  const rows = (await db.select().from(fontFaces).where(eq(fontFaces.source, 'google'))).sort((a, b) =>
    byCodeUnits(a.id, b.id),
  )
  const bytes = new TextEncoder().encode(JSON.stringify(toFamilies(rows)))
  return { hash: createHash('sha256').update(bytes).digest('hex').slice(0, 32), bytes }
}

/** A face the brand can use and short-lived URLs to its file and preview, or null. */
export async function fontLink(
  db: Db,
  storage: Storage,
  workspaceId: string,
  brandId: string,
  faceId: string,
): Promise<FontLink | null> {
  const row = await visibleFace(db, workspaceId, brandId, faceId)
  if (!row) return null
  const key = keyOf(row)
  const [file, preview] = await Promise.all([signedLink(storage, key), signedLink(storage, previewKey(key))])
  return { face: toFace(row), url: file.url, previewUrl: preview.url, expiresAt: file.expiresAt }
}

/**
 * The file or preview of a Google face, streamed from our storage, with its size (the file's as recorded, the
 * preview's when storage names it), or null for a face that isn't one of the Google catalog's: a brand's upload is
 * never read here.
 */
export async function googleFaceFile(
  db: Db,
  storage: Storage,
  faceId: string,
  kind: 'file' | 'preview',
): ReturnType<Storage['stream']> {
  const [row] = await db
    .select({ sha256: fontFaces.sha256, byteSize: fontFaces.byteSize })
    .from(fontFaces)
    .where(and(eq(fontFaces.id, faceId), eq(fontFaces.source, 'google')))
  if (!row) return null
  const key = googleFontKey(row.sha256)
  if (kind === 'preview') return storage.stream(previewKey(key))
  const stored = await storage.stream(key)
  return stored && { ...stored, byteSize: row.byteSize }
}

/**
 * The faces that draw these uses of the families as the brand sees them (`facesToLoad`), with their
 * bytes from our storage: what a render in Node registers, the same files the editor loads.
 * Each family's faces come in the catalog's order. Families the catalog doesn't have are left out,
 * and their text draws in the fallback fonts, as in the editor.
 */
export async function fontFiles(
  db: Db,
  storage: Storage,
  workspaceId: string,
  brandId: string,
  uses: readonly FontUse[],
): Promise<{ family: string; bytes: Uint8Array }[]> {
  const names = [...new Set(uses.map((use) => use.family))]
  if (names.length === 0) return []
  const rows = await db
    .select()
    .from(fontFaces)
    .where(and(inArray(fontFaces.family, names), visibleTo(workspaceId, brandId)))
  const picked = [...families(rows)].flatMap(([family, faces]) =>
    facesToLoad(
      faces.map((row) => ({ ...toFace(row), row })),
      uses.filter((use) => use.family === family),
    ).map(({ row }) => row),
  )
  return Promise.all(
    picked.map(async (row) => {
      const bytes = await storage.get(keyOf(row))
      if (!bytes) throw new Error(`the file of ${row.family} ${row.weight} ${row.style} is missing from storage`)
      return { family: row.family, bytes }
    }),
  )
}

/** The brand's face for these bytes when it has one; otherwise a signed URL to upload them. */
export async function startFontUpload(
  db: Db,
  storage: Storage,
  workspaceId: string,
  brandId: string,
  upload: StartFontUpload,
): Promise<FontUploadTicket> {
  const [existing] = await db
    .select()
    .from(fontFaces)
    .where(
      and(eq(fontFaces.workspaceId, workspaceId), eq(fontFaces.brandId, brandId), eq(fontFaces.sha256, upload.sha256)),
    )
  if (existing) return { face: toFace(existing), upload: null }
  const { url, expiresAt } = await signedUpload(storage, uploadedFontKey(workspaceId, upload.sha256), {
    contentType: upload.contentType,
    size: upload.byteSize,
  })
  return { face: null, upload: { url, headers: { 'content-type': upload.contentType }, expiresAt } }
}

/**
 * Records the font file stored under `sha256` as the brand's, named by its own tables, after
 * checking the bytes hash to it and CanvasKit reads them. A face the brand already has in that
 * family, weight and style is replaced; recording the same bytes again gives back the same face.
 */
export async function recordFont(
  db: Db,
  storage: Storage,
  workspaceId: string,
  brandId: string,
  sha256: string,
): Promise<FontFace> {
  const key = uploadedFontKey(workspaceId, sha256)
  const bytes = await storage.get(key)
  if (!bytes) throw new InvalidFont('Nothing was uploaded for that SHA-256')
  const [existing] = await db
    .select()
    .from(fontFaces)
    .where(and(eq(fontFaces.workspaceId, workspaceId), eq(fontFaces.brandId, brandId), eq(fontFaces.sha256, sha256)))
  if (existing) return toFace(existing)
  const refuse = await checkUpload(storage, key, bytes, sha256, InvalidFont)
  const info = readFontInfo(bytes)
  if (!info) throw await refuse('The upload is not a TrueType or OpenType font')
  let preview: Uint8Array
  try {
    preview = await fontPreview(bytes, info)
  } catch {
    throw await refuse('The font could not be read')
  }
  await storage.put(previewKey(key), preview, 'image/png')
  const row = {
    id: newId(),
    workspaceId,
    brandId,
    source: 'upload',
    family: info.family,
    weight: info.weight,
    weightMin: info.weights?.min ?? null,
    weightMax: info.weights?.max ?? null,
    style: info.style,
    category: null,
    sha256,
    byteSize: bytes.length,
  } as const
  await replaceFace(db, row)
  return toFace({ ...row, createdAt: new Date() })
}

/**
 * Puts a face in, taking the place of the one with the same family, weight and style in its scope.
 * A variable face never shares its family and style with another: one takes the place of every
 * face of its family and style, and any face takes the place of a variable one. Gives back the
 * SHA-256 of each face it took the place of.
 */
export async function replaceFace(db: Db, row: typeof fontFaces.$inferInsert): Promise<string[]> {
  return db.transaction(async (tx) => {
    // Two uploads of one family and style at once wait for each other, so neither keeps a face the other replaces.
    const scope = [row.workspaceId ?? '', row.brandId ?? '', row.family, row.style].join('\n')
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${scope}))`)
    const replaced = await tx
      .delete(fontFaces)
      .where(
        and(
          row.workspaceId ? eq(fontFaces.workspaceId, row.workspaceId) : isNull(fontFaces.workspaceId),
          row.brandId ? eq(fontFaces.brandId, row.brandId) : isNull(fontFaces.brandId),
          eq(fontFaces.family, row.family),
          eq(fontFaces.style, row.style),
          row.weightMin == null ? or(eq(fontFaces.weight, row.weight), isNotNull(fontFaces.weightMin)) : undefined,
        ),
      )
      .returning({ sha256: fontFaces.sha256 })
    await tx.insert(fontFaces).values(row)
    return replaced.map((one) => one.sha256)
  })
}

/** The faces of each family as the brand sees them: where it uploaded a family Google has, only its own. */
function families(rows: Row[]): Map<string, Row[]> {
  const out = new Map<string, Row[]>()
  for (const row of rows) {
    const known = out.get(row.family)
    if (!known) out.set(row.family, [row])
    else if (known[0]?.source === row.source) known.push(row)
    else if (row.source === 'upload') out.set(row.family, [row])
  }
  for (const faces of out.values()) faces.sort(byFace)
  return out
}

/** The catalog's families of these rows, by name in code-unit order, each face as `toFace` gives it. */
function toFamilies(rows: Row[]): FontFamily[] {
  return [...families(rows)]
    .sort(([a], [b]) => byCodeUnits(a, b))
    .map(([family, faces]) => {
      const source = faces[0]?.source ?? 'google'
      const listed = source === 'google' ? googleFamilies().get(family) : undefined
      return {
        family,
        source,
        category: faces[0]?.category ?? null,
        ...(listed ? { rank: listed.rank, scripts: listed.scripts } : {}),
        faces: faces.map(toFace),
      }
    })
}

/** `GOOGLE_FONTS` by family name. */
function googleFamilies(): ReadonlyMap<string, GoogleFamily> {
  googleByName ??= new Map(GOOGLE_FONTS.map((family) => [family.family, family]))
  return googleByName
}

async function visibleFace(db: Db, workspaceId: string, brandId: string, faceId: string) {
  const [row] = await db
    .select()
    .from(fontFaces)
    .where(and(eq(fontFaces.id, faceId), visibleTo(workspaceId, brandId)))
  return row ?? null
}
