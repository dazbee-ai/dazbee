// The routes of a workspace, its brands and their designs: the workspace's summary and name, renaming,
// copying and deleting a design, its picture and size for the library, and the token that opens it on
// the sync server. Each is mounted under the workspace it is for.
import { Hono } from 'hono'

import type { Db } from '@dazbee/db'
import {
  CreateBrand,
  CreateDesign,
  type DesignCover,
  type DesignThumbnail,
  DuplicateDesign,
  type OpenedDesign,
  Rename,
  type SyncToken,
  SyncTokenRequest,
  UpdateWorkspace,
} from '@dazbee/schema'
import type { Storage } from '@dazbee/storage'
import { signSyncToken } from '@dazbee/sync-token'

import { designCover, ensureDesignThumbnail } from '../drawing/design-thumbnails.ts'
import { body, type Env, error, requireManager, requireUnlimited, requireWriter } from '../http.ts'
import { userName } from '../sign-in/session.ts'
import { signedLink } from '../storage-keys.ts'
import {
  createDesign,
  deleteDesign,
  designSchemaVersion,
  findDesign,
  listDesigns,
  renameDesign,
  storedDesign,
} from './designs.ts'
import { createBrand, findWorkspace, listBrands, markWorkspaceUsed, updateWorkspace } from './workspace.ts'

/** The workspace itself, at the path it is mounted at. */
export function workspaceRoutes({ db }: { db: Db }): Hono<Env> {
  const app = new Hono<Env>()

  // Every page reads it, so it notes the visit: sign-in opens the workspace used last.
  app.get('/', async (c) => {
    const { workspaceId } = c.var.membership
    const [workspace] = await Promise.all([
      findWorkspace(db, workspaceId),
      markWorkspaceUsed(db, workspaceId, c.var.session.userId),
    ])
    return workspace ? c.json(workspace) : c.json(error('No such workspace'), 404)
  })

  // Settings renames the workspace.
  app.patch('/', requireManager, async (c) => {
    const input = await body(c.req.raw, UpdateWorkspace)
    if (input instanceof Response) return input
    const workspace = await updateWorkspace(db, c.var.membership.workspaceId, input)
    return workspace ? c.json(workspace) : c.json(error('No such workspace'), 404)
  })

  return app
}

/** The workspace's brands and their designs, below the path the workspace is mounted at. */
export function brandRoutes({ db, storage, syncSecret }: { db: Db; storage: Storage; syncSecret: string }): Hono<Env> {
  const app = new Hono<Env>()

  app.get('/brands', async (c) => {
    const { workspaceId, brandIds } = c.var.membership
    return c.json(await listBrands(db, workspaceId, brandIds))
  })

  app.post('/brands', requireWriter, requireUnlimited, async (c) => {
    const input = await body(c.req.raw, CreateBrand)
    if (input instanceof Response) return input
    return c.json(await createBrand(db, c.var.membership.workspaceId, input.name, input.website), 201)
  })

  app.get('/brands/:brandId/designs', async (c) => {
    const { workspaceId } = c.var.membership
    return c.json(await listDesigns(db, workspaceId, c.var.brand.id))
  })

  app.post('/brands/:brandId/designs', requireWriter, async (c) => {
    const { workspaceId } = c.var.membership
    const input = await body(c.req.raw, CreateDesign)
    if (input instanceof Response) return input
    return c.json(await createDesign(db, workspaceId, c.var.brand.id, input.name, input.content), 201)
  })

  // The design as the editor opens it, with the member asking: the editor takes up only their tab
  // copies on the device (D9).
  app.get('/brands/:brandId/designs/:designId', async (c) => {
    const { workspaceId } = c.var.membership
    const { userId } = c.var.session
    const design = await findDesign(db, workspaceId, c.var.brand.id, c.req.param('designId'))
    return design
      ? c.json({ ...design, member: { userId, workspaceId } } satisfies OpenedDesign)
      : c.json(error('No such design'), 404)
  })

  // A design's name in the library and the editor; its content is the sync server's.
  app.patch('/brands/:brandId/designs/:designId', requireWriter, async (c) => {
    const input = await body(c.req.raw, Rename)
    if (input instanceof Response) return input
    const design = await renameDesign(
      db,
      c.var.membership.workspaceId,
      c.var.brand.id,
      c.req.param('designId'),
      input.name,
    )
    return design ? c.json(design) : c.json(error('No such design'), 404)
  })

  // A copy of the design as it is stored now, in the same brand.
  app.post('/brands/:brandId/designs/:designId/duplicate', requireWriter, async (c) => {
    const { workspaceId } = c.var.membership
    const original = await findDesign(db, workspaceId, c.var.brand.id, c.req.param('designId'))
    if (!original) return c.json(error('No such design'), 404)
    const input = await body(c.req.raw, DuplicateDesign)
    if (input instanceof Response) return input
    const content = await storedDesign(db, original.id)
    if (!content) return c.json(error('This design has nothing stored to copy yet'), 409)
    return c.json(
      await createDesign(
        db,
        workspaceId,
        original.brandId,
        input.name ?? `${original.name} copy`.slice(0, 120),
        content,
      ),
      201,
    )
  })

  app.delete('/brands/:brandId/designs/:designId', requireWriter, async (c) => {
    const deleted = await deleteDesign(db, c.var.membership.workspaceId, c.var.brand.id, c.req.param('designId'))
    return deleted ? c.body(null, 204) : c.json(error('No such design'), 404)
  })

  // The cover frame's size alone, read without drawing, for the home to lay out its bento (#84).
  app.get('/brands/:brandId/designs/:designId/cover', async (c) => {
    const design = await findDesign(db, c.var.membership.workspaceId, c.var.brand.id, c.req.param('designId'))
    if (!design) return c.json(error('No such design'), 404)
    const cover = await designCover(db, design)
    return cover ? c.json(cover satisfies DesignCover) : c.json(error('This design has nothing to show yet'), 404)
  })

  app.get('/brands/:brandId/designs/:designId/thumbnail', async (c) => {
    const { workspaceId } = c.var.membership
    const design = await findDesign(db, workspaceId, c.var.brand.id, c.req.param('designId'))
    if (!design) return c.json(error('No such design'), 404)
    const cover = await ensureDesignThumbnail(db, storage, workspaceId, design)
    if (!cover) return c.json(error('This design has nothing to show yet'), 404)
    const { url, expiresAt } = await signedLink(storage, cover.key)
    return c.json({ url, width: cover.width, height: cover.height, expiresAt } satisfies DesignThumbnail)
  })

  // A token for the sync server, only after the same workspace and brand checks as opening the design,
  // carrying the member's role, which decides whether their connection may write, the design's
  // schema version, below which a tab may not open it, and their name, which the other tabs show. An
  // agent's token carries the role its access caps, and the agent's name its tab is shown by: the one
  // asked for, else "AI agent". A person's session names no agent.
  app.post('/brands/:brandId/designs/:designId/sync-token', async (c) => {
    const { workspaceId, role } = c.var.membership
    const { userId, agent } = c.var.session
    const input = await body(c.req.raw, SyncTokenRequest, { optional: true })
    if (input instanceof Response) return input
    if (!agent && input.agent !== undefined) return c.json(error('Only an agent’s token names an agent'), 400)
    const designId = c.req.param('designId')
    const schemaVersion = await designSchemaVersion(db, workspaceId, c.var.brand.id, designId)
    if (schemaVersion === null) return c.json(error('No such design'), 404)
    const name = await userName(db, userId)
    const agentName = agent ? { agent: input.agent?.replace(/\p{Cc}/gu, '').trim() || 'AI agent' } : {}
    const payload = { designId, workspaceId, userId, role, schemaVersion, name, ...agentName }
    const { token, expiresAt } = signSyncToken(syncSecret, payload)
    return c.json({
      token,
      expiresAt: new Date(expiresAt).toISOString(),
      member: { userId, workspaceId },
    } satisfies SyncToken)
  })

  return app
}
