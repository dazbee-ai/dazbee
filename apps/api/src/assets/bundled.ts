// Files Dazbee bundles and keeps in its storage rather than in the repository, such as Fluent Emoji's 3D pictures and
// the illustrations' SVG files: stored once under `bundled/<sha256>` from their pinned source, and added to a brand's
// asset library by copying the stored file into the workspace's originals and recording it as an upload is (the hash,
// the header, the decode, and for an SVG file the SVG reader's thread and limits).
import type { Db } from '@dazbee/db'
import { type AddBundledAsset, type AssetSummary, readImageHeader } from '@dazbee/schema'
import { originalKey, type Storage } from '@dazbee/storage'
import { SVG_TYPE, svgMarkup } from '@dazbee/svg'

import { BUNDLED, bundledKey } from '../storage-keys.ts'
import { findAsset, recordAsset, withTags } from './assets.ts'

/** A bundled file as its manifest lists it: at least its SHA-256. */
export interface BundledFile {
  sha256: string
}

/** Reads the bundled files' source and tells `onFile` each wanted file's bytes, checked against its SHA-256. */
export type ReadBundled<F extends BundledFile> = (
  wanted: readonly F[],
  onFile: (file: F, bytes: Uint8Array) => Promise<void>,
) => Promise<void>

/** Dazbee's storage holds no bundled file with the SHA-256 asked for. */
export class NotBundled extends Error {
  constructor() {
    super('Dazbee keeps no bundled file with that SHA-256; it may not be stored yet')
  }
}

/**
 * The brand's asset of the bundled file `input.sha256`: the one it has of those bytes, or a new one named
 * `input.name`, recorded from the workspace's original, which is copied from the bundled file first when the
 * workspace doesn't hold it yet; either way with `input.tags` joining its own. It throws `NotBundled` when storage
 * holds no bundled file of that SHA-256, whatever the workspace holds.
 */
export async function addBundledAsset(
  db: Db,
  storage: Storage,
  workspaceId: string,
  brandId: string,
  input: AddBundledAsset,
): Promise<AssetSummary> {
  if (!(await storage.exists(bundledKey(input.sha256)))) throw new NotBundled()
  const asset =
    (await findAsset(db, workspaceId, brandId, { sha256: input.sha256 })) ??
    (await recordBundled(db, storage, workspaceId, brandId, input))
  return withTags(db, workspaceId, brandId, asset, input.tags)
}

/**
 * Stores each of `files` that storage doesn't hold yet under `bundled/<sha256>`, its bytes read by `read`, which is
 * not called when every file is stored already; answers how many it stored and how many were stored before.
 */
export async function storeBundled<F extends BundledFile>(
  storage: Storage,
  files: readonly F[],
  read: ReadBundled<F>,
): Promise<{ stored: number; already: number }> {
  const held = new Set(await storage.list(BUNDLED))
  const missing = files.filter(({ sha256 }) => !held.has(bundledKey(sha256)))
  let stored = 0
  if (missing.length > 0)
    await read(missing, async ({ sha256 }, bytes) => {
      await storage.put(bundledKey(sha256), bytes, contentTypeOf(bytes))
      stored++
    })
  return { stored, already: files.length - missing.length }
}

/** Copies the bundled file into the workspace's originals, when they don't hold it yet, and records it. */
async function recordBundled(
  db: Db,
  storage: Storage,
  workspaceId: string,
  brandId: string,
  { sha256, name }: AddBundledAsset,
): Promise<AssetSummary> {
  const original = originalKey(workspaceId, sha256)
  if (await storage.exists(original)) return recordAsset(db, storage, workspaceId, brandId, sha256, name)
  const bytes = await storage.get(bundledKey(sha256))
  if (!bytes) throw new NotBundled()
  await storage.put(original, bytes, contentTypeOf(bytes))
  return recordAsset(db, storage, workspaceId, brandId, sha256, name, bytes)
}

/** A file's type as its header says, or SVG for SVG markup, for storage to serve it with. */
function contentTypeOf(bytes: Uint8Array): string {
  const image = readImageHeader(bytes)?.contentType
  if (image) return image
  return svgMarkup(new TextDecoder().decode(bytes)) ? SVG_TYPE : 'application/octet-stream'
}
