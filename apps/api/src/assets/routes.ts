// The routes of a brand's asset library, its images and SVG files: uploading and recording them, adding one
// from an outside link or through an agent's upload link, finding them by name and tag, naming and tagging them,
// their thumbnails, and deleting one nothing shows; and the upload links themselves, which take a file with no
// session.
import { Hono } from 'hono'

import type { Db } from '@dazbee/db'
import {
  AddAssetFromUrl,
  type AssetInUse,
  type AssetLink,
  RecordAsset,
  type SignedLink,
  StartUpload,
  StartUploadLink,
  UpdateAsset,
  UPLOAD_LINK_PATH,
} from '@dazbee/schema'
import type { Storage } from '@dazbee/storage'

import type { Admins } from '../admin/admins.ts'
import { requestLimit } from '../admin/waiting-list.ts'
import type { SafeFetchSettings } from '../fetch/safe-fetch.ts'
import { body, type Env, error, requireWriter } from '../http.ts'
import { originalKey, signedLink } from '../storage-keys.ts'
import {
  deleteAsset,
  ensureThumbnail,
  findAsset,
  listAssets,
  listedAssetUses,
  recordAsset,
  startUpload,
  updateAsset,
} from './assets.ts'
import { addAssetFromUrl } from './from-url.ts'
import { createUploadLink, UPLOADS_PER_ADDRESS_PER_HOUR, uploadToLink } from './upload-links.ts'

export function assetRoutes({
  db,
  storage,
  outsideFetch,
  fromUrlPerHour,
}: {
  db: Db
  storage: Storage
  /** How the safe fetch reaches outside sites. */
  outsideFetch: SafeFetchSettings
  /** The pictures from links a member may add in an hour, themselves and their agents together. */
  fromUrlPerHour: number
}): Hono<Env> {
  const app = new Hono<Env>()
  const fromUrl = requestLimit({ perWindow: fromUrlPerHour })
  // Upload links count as many in an hour as pictures from links do, apart from them.
  const uploadLinkLimit = requestLimit({ perWindow: fromUrlPerHour })

  // Images: uploads go straight to storage through a signed URL, then are recorded here (#35).
  // The asset library (#52) finds them by name and tag: ?q=summer sale.
  app.get('/brands/:brandId/assets', async (c) => {
    const { workspaceId } = c.var.membership
    const query = c.req.query('q') ?? ''
    if (query.length > 200) return c.json(error('A search is at most 200 characters'), 400)
    return c.json(await listAssets(db, workspaceId, c.var.brand.id, query))
  })

  app.post('/brands/:brandId/assets/uploads', requireWriter, async (c) => {
    const { workspaceId } = c.var.membership
    const input = await body(c.req.raw, StartUpload)
    if (input instanceof Response) return input
    return c.json(await startUpload(db, storage, workspaceId, c.var.brand.id, input))
  })

  app.post('/brands/:brandId/assets', requireWriter, async (c) => {
    const { workspaceId } = c.var.membership
    const input = await body(c.req.raw, RecordAsset)
    if (input instanceof Response) return input
    return c.json(await recordAsset(db, storage, workspaceId, c.var.brand.id, input.sha256, input.name), 201)
  })

  // A picture from an outside https link, fetched by the API and recorded as an upload is; an agent's way in.
  app.post('/brands/:brandId/assets/from-url', requireWriter, async (c) => {
    const { workspaceId } = c.var.membership
    const input = await body(c.req.raw, AddAssetFromUrl)
    if (input instanceof Response) return input
    if (!fromUrl.take(c.var.session.userId))
      return c.json(
        error(
          `This member has added as many pictures from links as they may in an hour (${fromUrlPerHour}); try again later`,
        ),
        429,
      )
    return c.json(await addAssetFromUrl(db, storage, outsideFetch, workspaceId, c.var.brand.id, input), 201)
  })

  // A one-time link an agent sends one file to from its machine (`upload_image`), taken by `uploadRoutes`.
  app.post('/brands/:brandId/assets/upload-links', requireWriter, async (c) => {
    const { workspaceId } = c.var.membership
    const input = await body(c.req.raw, StartUploadLink)
    if (input instanceof Response) return input
    const { userId, agent } = c.var.session
    if (!uploadLinkLimit.take(userId))
      return c.json(
        error(
          `This member has asked for as many upload links as they may in an hour (${fromUrlPerHour}); try again later`,
        ),
        429,
      )
    const asker = { workspaceId, brandId: c.var.brand.id, userId, accessId: agent?.accessId ?? null }
    return c.json(await createUploadLink(db, asker, input), 201)
  })

  app.get('/brands/:brandId/assets/:assetId', async (c) => {
    const { workspaceId } = c.var.membership
    const asset = await findAsset(db, workspaceId, c.var.brand.id, { id: c.req.param('assetId') })
    if (!asset) return c.json(error('No such asset'), 404)
    const { url, expiresAt } = await signedLink(storage, originalKey(workspaceId, asset.sha256))
    return c.json({ asset, url, expiresAt } satisfies AssetLink)
  })

  app.patch('/brands/:brandId/assets/:assetId', requireWriter, async (c) => {
    const { workspaceId } = c.var.membership
    const input = await body(c.req.raw, UpdateAsset)
    if (input instanceof Response) return input
    const asset = await updateAsset(db, workspaceId, c.var.brand.id, c.req.param('assetId'), input)
    if (!asset) return c.json(error('No such asset'), 404)
    return c.json(asset)
  })

  // What shows an image, asked before deleting it; deleting one a design, a template or the logo
  // still shows is refused, saying which.
  app.get('/brands/:brandId/assets/:assetId/uses', async (c) => {
    const { workspaceId } = c.var.membership
    const uses = await listedAssetUses(db, workspaceId, c.var.brand.id, c.req.param('assetId'))
    if (!uses) return c.json(error('No such asset'), 404)
    return c.json(uses)
  })

  app.delete('/brands/:brandId/assets/:assetId', requireWriter, async (c) => {
    const { workspaceId } = c.var.membership
    const result = await deleteAsset(db, workspaceId, c.var.brand.id, c.req.param('assetId'))
    if (!result) return c.json(error('No such asset'), 404)
    if ('usedIn' in result)
      return c.json({ ...error('The image is in use'), usedIn: result.usedIn } satisfies AssetInUse, 409)
    return c.body(null, 204)
  })

  app.get('/brands/:brandId/assets/:assetId/thumbnail', async (c) => {
    const { workspaceId } = c.var.membership
    const asset = await findAsset(db, workspaceId, c.var.brand.id, { id: c.req.param('assetId') })
    if (!asset) return c.json(error('No such asset'), 404)
    return c.json((await signedLink(storage, await ensureThumbnail(storage, workspaceId, asset))) satisfies SignedLink)
  })

  return app
}

/**
 * `PUT /uploads/:token`: the file sent to an upload link, with no session, recorded into the link's brand; the answer
 * is its asset. Caddy sends only this method and path of the API to the internet, with a body cap.
 */
export function uploadRoutes({ db, storage, admins }: { db: Db; storage: Storage; admins: Admins }): Hono<Env> {
  const app = new Hono<Env>()
  // Counted by the address Cloudflare names, the only way in.
  const perAddress = requestLimit({ perWindow: UPLOADS_PER_ADDRESS_PER_HOUR })
  app.put(`${UPLOAD_LINK_PATH}:token`, async (c) => {
    if (!perAddress.take(c.req.header('cf-connecting-ip')?.trim() ?? ''))
      return c.json(
        error(
          `This address has sent as many files as it may in an hour (${UPLOADS_PER_ADDRESS_PER_HOUR}); try again later`,
        ),
        429,
      )
    return c.json(await uploadToLink({ db, storage, admins }, c.req.param('token'), c.req.raw), 201)
  })
  return app
}
