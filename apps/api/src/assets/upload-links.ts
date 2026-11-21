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
  MAX_SVG_BYTES,
  maxBytesOf,
  readImageHeader,
  roleWrites,
  type StartUploadLink,
  UPLOAD_LINK_MS,
  UPLOAD_LINK_PATH,
  type UploadLink,
} from '@dazbee/schema'
import type { Storage } from '@dazbee/storage'
import { SVG_TYPE, svgMarkup } from '@dazbee/svg'

import { hashOf } from '../agents/agent-accesses.ts'
import { findAccess } from '../workspace/workspace.ts'
import { addingFromOutside, AddingFromUrlBusy, MAX_FROM_URL_PIXELS, recordPicture } from './from-url.ts'
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
  readonly status: 400 | 403 | 404 | 408 | 410 | 413 | 503
  constructor(status: UploadLinkRefused['status'], message: string) {
    super(message)
    this.status = status
  }
}

/** How long a file may take to arrive once it starts: 30 MiB at 4 Mbit/s. */
export const RECEIVE_TIMEOUT_MS = 60_000

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
 * is. The first request that reaches the file spends the link; it is kept for another try only when Dazbee was busy
 * or the file broke off. It throws `UploadLinkRefused` for an unknown, used or expired link, a member or access that
 * may no longer add to the brand, a file over the type's limit, of another type, or that is not a picture, and
 * `InvalidUpload` for one the upload path refuses.
 */
export async function uploadToLink(
  db: Db,
  storage: Storage,
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
  if (!(await mayStillAdd(db, link)))
    throw new UploadLinkRefused(
      403,
      'The access that asked for this upload link may no longer add images to this brand',
    )
  try {
    return await addingFromOutside(async () => {
      if (!(await claim(db, hash, now))) throw new UploadLinkRefused(410, `This upload link has been used; ${NEW_LINK}`)
      try {
        const bytes = await receive(request, link.contentType)
        checkType(bytes, link.contentType)
        return await recordPicture(db, storage, link.workspaceId, link.brandId, bytes, link.contentType, {
          name: link.name,
          tags: link.tags,
        })
      } catch (error) {
        if (error instanceof SvgBusy || (error instanceof UploadLinkRefused && error.status === 408))
          await release(db, hash)
        throw error
      }
    })
  } catch (error) {
    if (error instanceof AddingFromUrlBusy)
      throw new UploadLinkRefused(
        503,
        'Dazbee is busy adding another picture; send the file to the same link again in a moment',
      )
    throw error
  }
}

/**
 * Whether the link's member still writes in its brand, and its agent access, when it has one, is live, edits and
 * reaches the brand: either may have changed since the link was made.
 */
async function mayStillAdd(db: Db, link: typeof uploadLinks.$inferSelect): Promise<boolean> {
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
            `The file took longer than ${RECEIVE_TIMEOUT_MS / 1000} seconds to arrive; send it to the same link again`,
          ),
        ),
      RECEIVE_TIMEOUT_MS,
    )
  })
  try {
    for (;;) {
      const read = await Promise.race([reader.read(), late]).catch((error: unknown) => {
        if (error instanceof UploadLinkRefused) throw error
        throw new UploadLinkRefused(408, 'The file broke off before it all arrived; send it to the same link again')
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
 * Refuses bytes that aren't a picture of `type`: a PNG, JPEG or WebP by its header, at most `MAX_FROM_URL_PIXELS`,
 * or an SVG file by its markup.
 */
function checkType(bytes: Uint8Array, type: ImageType): void {
  const header = readImageHeader(bytes)
  const sent =
    header?.contentType ??
    (svgMarkup(Buffer.from(bytes.subarray(0, MAX_SVG_BYTES + 1)).toString('utf8')) ? SVG_TYPE : null)
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
  if (header && header.width * header.height > MAX_FROM_URL_PIXELS)
    throw new UploadLinkRefused(
      400,
      `The picture is over ${MAX_FROM_URL_PIXELS / 1_000_000} megapixels, the most an agent may add; send a smaller one with a new link from upload_image`,
    )
}
