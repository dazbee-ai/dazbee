// Upload links (`upload_image`): a member, or their agent, asks for a one-time link under a brand, and the first file
// sent to it, with no session, is recorded as an upload is (the hash, the header, CanvasKit's decode, the SVG reader
// on its worker thread) into that brand's asset library. Only the SHA-256 of a link's token is kept, the link is
// spent by the first file that reaches it, and it grants nothing else: no reading, no other brand.
import { randomBytes } from 'node:crypto'

import { and, eq, gt, isNull, lt } from 'drizzle-orm'

import { agentAccesses, type Db, uploadLinks } from '@dazbee/db'
import {
  type AssetSummary,
  type ImageType,
  maxBytesOf,
  readImageHeader,
  roleWrites,
  type StartUploadLink,
  UPLOAD_LINK_MS,
  UPLOAD_LINK_PATH,
  type UploadLink,
} from '@dazbee/schema'
import type { Storage } from '@dazbee/storage'
import { SVG_TYPE } from '@dazbee/svg'

import type { Admins } from '../admin/admins.ts'
import { isRemovedUser } from '../admin/dazbee-invites.ts'
import { hashOf } from '../agents/agent-accesses.ts'
import { findAccess } from '../workspace/workspace.ts'
import { addingFromOutside, AddingFromUrlBusy, MAX_OUTSIDE_PIXELS, pictureTypeOf, recordPicture } from './from-url.ts'
import { SvgBusy } from './svg-assets.ts'

/** Who asks for an upload link, and for which brand: a member, through their agent access when `accessId` is set. */
export interface LinkAsker {
  workspaceId: string
  brandId: string
  userId: string
  accessId: string | null
}

/** A file sent to an upload link, or the link itself, refused: the answer's status and its sentence. */
export class UploadLinkRefused extends Error {
  readonly status: 400 | 403 | 404 | 408 | 410 | 413 | 429 | 503
  constructor(status: UploadLinkRefused['status'], message: string) {
    super(message)
    this.status = status
  }
}

/** How long a file may take to arrive once it starts: 30 MiB at 4 Mbit/s. */
export const RECEIVE_TIMEOUT_MS = 60_000
/** The files sent to upload links one address may send in an hour, refused or not. */
export const UPLOADS_PER_ADDRESS_PER_HOUR = 120
/**
 * The files arriving at upload links at once in the process: two, as each holds up to `MAX_UPLOAD_BYTES` twice
 * over (its pieces, then the whole) beside the one picture from outside being recorded.
 */
export const MAX_RECEIVING_AT_ONCE = 2

/** A link's token: 32 random bytes in base64url. */
const TOKEN = /^[\w-]{43}$/
/** How long a row stays after its link expires, so a late file is told it expired rather than unknown. */
const KEPT_EXPIRED_MS = 24 * 60 * 60 * 1000
/** Each type's name in a sentence. */
const TYPE_NAMES: Record<ImageType, string> = {
  'image/png': 'PNG',
  'image/jpeg': 'JPEG',
  'image/webp': 'WebP',
  'image/svg+xml': 'SVG',
}
/** What every refusal that spends the link ends with. */
const NEW_LINK = 'ask upload_image for a new one'

/** The files arriving at upload links now. */
let receiving = 0

/**
 * A new upload link for one file of `input.contentType`, named `input.name` and tagged `input.tags`, into the
 * asker's brand, working for `UPLOAD_LINK_MS` from `now`. Links expired a day ago are deleted.
 */
export async function createUploadLink(
  db: Db,
  asker: LinkAsker,
  input: StartUploadLink,
  now = new Date(),
): Promise<UploadLink> {
  await db.delete(uploadLinks).where(lt(uploadLinks.expiresAt, new Date(now.getTime() - KEPT_EXPIRED_MS)))
  const token = randomBytes(32).toString('base64url')
  const expiresAt = new Date(now.getTime() + UPLOAD_LINK_MS)
  await db.insert(uploadLinks).values({
    hash: hashOf(token),
    ...asker,
    contentType: input.contentType,
    name: input.name,
    tags: input.tags ?? [],
    expiresAt,
  })
  return {
    path: `${UPLOAD_LINK_PATH}${token}`,
    expiresAt: expiresAt.toISOString(),
    maxBytes: maxBytesOf(input.contentType),
  }
}

/**
 * The asset of the file `request` sends to the upload link of `token`, recorded into the link's brand as an upload
 * is. The first request that reaches the file spends the link, which is kept for another try only when Dazbee was
 * too busy to take it. The file arrives outside the one place for a picture from outside, at most
 * `MAX_RECEIVING_AT_ONCE` at a time, so a slow sender holds up only other uploads. It throws `UploadLinkRefused` for
 * an unknown, used or expired link, a member or access that may no longer add to the brand, a file over the type's
 * limit, slower than `RECEIVE_TIMEOUT_MS`, broken off, of another type, or not a picture, and for Dazbee being busy;
 * and `InvalidUpload` for one the upload path refuses.
 */
export async function uploadToLink(
  { db, storage, admins }: { db: Db; storage: Storage; admins: Admins },
  token: string,
  request: Request,
  now = new Date(),
): Promise<AssetSummary> {
  const hash = TOKEN.test(token) ? hashOf(token) : null
  const [link] = hash ? await db.select().from(uploadLinks).where(eq(uploadLinks.hash, hash)) : []
  if (!hash || !link)
    throw new UploadLinkRefused(404, 'This is not an upload link Dazbee gave; ask upload_image for one')
  if (link.usedAt) throw new UploadLinkRefused(410, `This upload link has been used; ${NEW_LINK}`)
  if (link.expiresAt <= now)
    throw new UploadLinkRefused(
      410,
      `This upload link has expired: a link works for ${UPLOAD_LINK_MS / 60_000} minutes; ${NEW_LINK}`,
    )
  if (!(await mayStillAdd(db, admins, link)))
    throw new UploadLinkRefused(
      403,
      'The access that asked for this upload link may no longer add images to this brand',
    )
  if (receiving >= MAX_RECEIVING_AT_ONCE) throw busy()
  receiving++
  let bytes: Uint8Array
  try {
    if (!(await claim(db, hash, now))) throw new UploadLinkRefused(410, `This upload link has been used; ${NEW_LINK}`)
    bytes = await receive(request, link.contentType)
  } finally {
    receiving--
  }
  checkType(bytes, link.contentType)
  try {
    return await addingFromOutside(() =>
      recordPicture(db, storage, link.workspaceId, link.brandId, bytes, link.contentType, {
        name: link.name,
        tags: link.tags,
      }),
    )
  } catch (error) {
    if (!(error instanceof SvgBusy || error instanceof AddingFromUrlBusy)) throw error
    await release(db, hash)
    throw busy()
  }
}

/**
 * Whether the link's member is still let in, still writes in its brand, and its agent access, when it has one, is
 * live, edits and reaches the brand: any of these may have changed since the link was made.
 */
async function mayStillAdd(db: Db, admins: Admins, link: typeof uploadLinks.$inferSelect): Promise<boolean> {
  if (await isRemovedUser(db, link.userId, admins)) return false
  const member = await findAccess(db, link.workspaceId, link.userId)
  if (!member || !roleWrites(member.role) || (member.brandIds && !member.brandIds.includes(link.brandId))) return false
  if (!link.accessId) return true
  const [access] = await db
    .select({ writes: agentAccesses.writes, brandIds: agentAccesses.brandIds })
    .from(agentAccesses)
    .where(and(eq(agentAccesses.id, link.accessId), isNull(agentAccesses.endedAt)))
  return Boolean(access?.writes && (!access.brandIds || access.brandIds.includes(link.brandId)))
}

/** Spends the link of `hash` if it is unused and unexpired at `now`; whether it did. */
async function claim(db: Db, hash: string, now: Date): Promise<boolean> {
  const claimed = await db
    .update(uploadLinks)
    .set({ usedAt: now })
    .where(and(eq(uploadLinks.hash, hash), isNull(uploadLinks.usedAt), gt(uploadLinks.expiresAt, now)))
    .returning({ hash: uploadLinks.hash })
  return claimed.length > 0
}

/** Makes the link of `hash` unused again, for another try. */
async function release(db: Db, hash: string): Promise<void> {
  await db.update(uploadLinks).set({ usedAt: null }).where(eq(uploadLinks.hash, hash))
}

/**
 * The request's body, refused past the most bytes a file of `type` may have, by its content-length before reading
 * or as it arrives, and past `RECEIVE_TIMEOUT_MS`.
 */
async function receive(request: Request, type: ImageType): Promise<Uint8Array> {
  const max = maxBytesOf(type)
  const tooBig = () =>
    new UploadLinkRefused(
      413,
      `The file is over ${type === SVG_TYPE ? `${max / 1_000_000} MB, the most an SVG file` : `${max / 1024 / 1024} MB, the most a picture`} may have; send a smaller one with a new link from upload_image`,
    )
  if (Number(request.headers.get('content-length') ?? 0) > max) throw tooBig()
  const reader = request.body?.getReader()
  if (!reader) return new Uint8Array()
  const chunks: Uint8Array[] = []
  let size = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new UploadLinkRefused(
            408,
            `The file took longer than ${RECEIVE_TIMEOUT_MS / 1000} seconds to arrive; ${NEW_LINK}`,
          ),
        ),
      RECEIVE_TIMEOUT_MS,
    )
  })
  try {
    for (;;) {
      const read = await Promise.race([reader.read(), late]).catch((error: unknown) => {
        if (error instanceof UploadLinkRefused) throw error
        throw new UploadLinkRefused(400, `The file broke off before it all arrived; ${NEW_LINK}`)
      })
      if (read.done) break
      size += read.value.byteLength
      if (size > max) throw tooBig()
      chunks.push(read.value)
    }
  } catch (error) {
    void reader.cancel().catch(() => {})
    throw error
  } finally {
    clearTimeout(timer)
  }
  const bytes = new Uint8Array(size)
  let at = 0
  for (const chunk of chunks) {
    bytes.set(chunk, at)
    at += chunk.byteLength
  }
  return bytes
}

/**
 * Refuses bytes that aren't a picture of `type`: a PNG, JPEG or WebP by its header, at most `MAX_OUTSIDE_PIXELS`,
 * or an SVG file by its markup.
 */
function checkType(bytes: Uint8Array, type: ImageType): void {
  const sent = pictureTypeOf(bytes)
  if (!sent)
    throw new UploadLinkRefused(
      400,
      'The file is not a PNG, JPEG, WebP or SVG picture; ask upload_image for a new link',
    )
  if (sent !== type)
    throw new UploadLinkRefused(
      400,
      `The file is a ${TYPE_NAMES[sent]}, but this link is for a ${TYPE_NAMES[type]}; ask upload_image for a link of the file’s type`,
    )
  const header = readImageHeader(bytes)
  if (header && header.width * header.height > MAX_OUTSIDE_PIXELS)
    throw new UploadLinkRefused(
      400,
      `The picture is over ${MAX_OUTSIDE_PIXELS / 1_000_000} megapixels, the most an agent may add; send a smaller one with a new link from upload_image`,
    )
}

/** Dazbee too busy to take the file now; the link is kept. */
function busy(): UploadLinkRefused {
  return new UploadLinkRefused(
    503,
    'Dazbee is busy adding other pictures; send the file to the same link again in a minute',
  )
}
