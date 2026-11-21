// Pictures a brand adds from an outside link: fetched through the safe fetch, stored by their hash and recorded
// with the upload path's checks (the hash, the header, CanvasKit's decode, the SVG reader), as an upload is.
import { createHash } from 'node:crypto'

import type { Db } from '@dazbee/db'
import {
  type AddAssetFromUrl,
  type AssetSummary,
  FROM_URL_TIMEOUT_MS,
  type ImageType,
  MAX_ASSET_TAGS,
  MAX_SVG_BYTES,
  MAX_UPLOAD_BYTES,
  readImageHeader,
} from '@dazbee/schema'
import type { Storage } from '@dazbee/storage'
import { SVG_TYPE, svgMarkup } from '@dazbee/svg'

import { type FetchedFile, safeFetch, type SafeFetchSettings } from '../fetch/safe-fetch.ts'
import { originalKey } from '../storage-keys.ts'
import { InvalidUpload, recordAsset, updateAsset } from './assets.ts'

/** Another picture is being added from a link; this one is refused until it ends. */
export class AddingFromUrlBusy extends Error {
  constructor() {
    super('Dazbee is busy adding another picture from a link; try again in a moment')
  }
}

/** The pictures from links a member may add in an hour, themselves and their agents together. */
export const FROM_URL_PER_HOUR = 60

/**
 * The most pixels a picture from a link has: a 6,000 × 4,000 photo and a little more. Its decode (4 bytes a pixel,
 * and a third more for the thumbnail's mipmaps) then fits beside everything else in the API's 512 MB.
 */
const MAX_FROM_URL_PIXELS = 25_000_000
/**
 * The most pictures added from links at once in the process: one, as each holds up to `MAX_UPLOAD_BYTES` and a
 * decode while it is fetched and recorded.
 */
const MAX_ADDING_AT_ONCE = 1

/** The pictures being added from links now. */
let adding = 0

/**
 * The asset of the picture at `input.url` in the brand's library: a new one named `input.name` (else by the link's
 * file name, else its host), or the brand's asset of the same bytes; either way with `input.tags` joining its own.
 * It throws `FetchRefused` for a link the safe fetch refuses, `InvalidUpload` for a file that isn't a picture
 * Dazbee takes from a link, and `AddingFromUrlBusy` past `MAX_ADDING_AT_ONCE`.
 */
export async function addAssetFromUrl(
  db: Db,
  storage: Storage,
  outside: SafeFetchSettings,
  workspaceId: string,
  brandId: string,
  input: AddAssetFromUrl,
): Promise<AssetSummary> {
  if (adding >= MAX_ADDING_AT_ONCE) throw new AddingFromUrlBusy()
  adding++
  try {
    const file = await safeFetch(input.url, { maxBytes: MAX_UPLOAD_BYTES, timeoutMs: FROM_URL_TIMEOUT_MS }, outside)
    const contentType = pictureType(file)
    const sha256 = createHash('sha256').update(file.bytes).digest('hex')
    const key = originalKey(workspaceId, sha256)
    if (!(await storage.exists(key))) await storage.put(key, file.bytes, contentType)
    const name = input.name ?? nameOf(input.url)
    const asset = await recordAsset(db, storage, workspaceId, brandId, sha256, name, file.bytes)
    const tags = [...new Set([...asset.tags, ...(input.tags ?? [])])].slice(0, MAX_ASSET_TAGS)
    if (tags.length === asset.tags.length) return asset
    return (await updateAsset(db, workspaceId, brandId, asset.id, { tags })) ?? asset
  } finally {
    adding--
  }
}

/**
 * The type of picture the file is, read from its bytes: a PNG, JPEG or WebP by its header, at most
 * `MAX_FROM_URL_PIXELS`, or an SVG file by its markup, at most `MAX_SVG_BYTES`. It throws `InvalidUpload` for
 * anything else, saying what the site sent when that is a media type.
 */
function pictureType({ bytes, contentType }: FetchedFile): ImageType {
  const header = readImageHeader(bytes)
  if (header) {
    if (header.width * header.height > MAX_FROM_URL_PIXELS)
      throw new InvalidUpload(
        `A picture from a link is at most ${MAX_FROM_URL_PIXELS / 1_000_000} megapixels; ask for a smaller one`,
      )
    return header.contentType
  }
  if (svgMarkup(Buffer.from(bytes.subarray(0, Math.min(bytes.length, MAX_SVG_BYTES + 1))).toString('utf8'))) {
    if (bytes.length > MAX_SVG_BYTES)
      throw new InvalidUpload(`An SVG file is at most ${MAX_SVG_BYTES / 1_000_000} MB; ask for a smaller one`)
    return SVG_TYPE
  }
  const said = contentType?.split(';')[0]?.trim().toLowerCase() ?? ''
  if (said === 'text/html' || said === 'application/xhtml+xml')
    throw new InvalidUpload(
      'The link opens a web page, not a picture: give the link of the picture itself (open the picture on its own and copy its address)',
    )
  const named = /^[a-z0-9.+-]{1,40}\/[a-z0-9.+-]{1,60}$/.test(said) ? ` (it is ${said})` : ''
  throw new InvalidUpload(`The file at that link is not a PNG, JPEG, WebP or SVG picture${named}`)
}

/** A picture's name from its link: the last part of its path, else its host, at most 120 characters. */
function nameOf(link: string): string {
  const url = new URL(link)
  const last = url.pathname.split('/').findLast(Boolean) ?? ''
  let name: string
  try {
    name = decodeURIComponent(last)
  } catch {
    name = last
  }
  return (name.trim() || url.hostname).slice(0, 120)
}
