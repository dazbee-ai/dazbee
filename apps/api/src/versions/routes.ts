// A design's version history: anyone who can open the design lists its versions and gets their
// pictures; a member whose role writes saves a named version of the design as stored, renames one,
// deletes one, and makes a design from one (Open as a copy).
import { type Context, Hono } from 'hono'

import { addVersion, type Db, deleteVersion, listVersions, renameVersion, type VersionRow } from '@dazbee/db'
import {
  CopyVersion,
  RenameVersion,
  SaveVersion,
  SCHEMA_VERSION,
  type VersionKind,
  type VersionSummary,
} from '@dazbee/schema'
import type { Storage } from '@dazbee/storage'

import { body, type Env, error, requireWriter } from '../http.ts'
import { createDesign, findDesign } from '../workspace/designs.ts'
import { versionPicture } from './version-pictures.ts'
import { storedWithPlace, versionDesign } from './versions.ts'

/** What an automatic version is called in a copy's name when it has no name of its own. */
const AUTOMATIC_NAMES: Record<Exclude<VersionKind, 'named'>, string> = {
  auto: 'Autosave',
  beforeRestore: 'Before restore',
  beforeAgent: 'Before agent',
}

const FULL = 'The version history is full. Delete a version to save another.'

const PATH = '/brands/:brandId/designs/:designId/versions'

export function versionRoutes({ db, storage }: { db: Db; storage: Storage }): Hono<Env> {
  const app = new Hono<Env>()

  /** The route's design, in the membership's workspace and the route's brand; null for none. */
  const designOf = (c: Context<Env>) =>
    findDesign(db, c.var.membership.workspaceId, c.var.brand.id, c.req.param('designId') ?? '')

  /** The version `versionId` of the design as listed; undefined for none. */
  const listed = async (designId: string, versionId: string) =>
    (await listVersions(db, designId)).find((v) => v.id === versionId)

  app.get(PATH, async (c) => {
    const design = await designOf(c)
    if (!design) return c.json(error('No such design'), 404)
    return c.json((await listVersions(db, design.id)).map(summaryOf))
  })

  // A named version of the design as stored now, at its place in the stored history.
  app.post(PATH, requireWriter, async (c) => {
    const design = await designOf(c)
    if (!design) return c.json(error('No such design'), 404)
    const input = await body(c.req.raw, SaveVersion)
    if (input instanceof Response) return input
    const stored = await storedWithPlace(db, design.id)
    if (!stored) return c.json(error('This design has nothing stored to save yet'), 409)
    const count = (await listVersions(db, design.id)).length
    const added = await addVersion(db, design.id, {
      kind: 'named',
      name: input.name || `Version ${count + 1}`,
      description: input.description ?? '',
      savedBy: c.var.session.userId,
      syncId: stored.syncId,
      seq: stored.seq,
      schemaVersion: SCHEMA_VERSION,
      records: stored.records,
      keep: null,
    })
    if (added === 'full') return c.json(error(FULL), 409)
    const saved = typeof added === 'object' ? await listed(design.id, added.id) : undefined
    return saved ? c.json(summaryOf(saved), 201) : c.json(error('No such design'), 404)
  })

  app.patch(`${PATH}/:versionId`, requireWriter, async (c) => {
    const design = await designOf(c)
    if (!design) return c.json(error('No such design'), 404)
    const input = await body(c.req.raw, RenameVersion)
    if (input instanceof Response) return input
    const versionId = c.req.param('versionId')
    const renamed = await renameVersion(db, design.id, versionId, {
      name: input.name,
      ...(input.description === undefined ? {} : { description: input.description }),
      by: c.var.session.userId,
    })
    const version = renamed ? await listed(design.id, versionId) : undefined
    return version ? c.json(summaryOf(version)) : c.json(error('No such version'), 404)
  })

  app.delete(`${PATH}/:versionId`, requireWriter, async (c) => {
    const design = await designOf(c)
    if (!design) return c.json(error('No such design'), 404)
    const deleted = await deleteVersion(db, design.id, c.req.param('versionId'))
    return deleted ? c.body(null, 204) : c.json(error('No such version'), 404)
  })

  // Open as a copy: a design of its own in the same brand, from the version's records, with no versions.
  app.post(`${PATH}/:versionId/copy`, requireWriter, async (c) => {
    const design = await designOf(c)
    if (!design) return c.json(error('No such design'), 404)
    const input = await body(c.req.raw, CopyVersion)
    if (input instanceof Response) return input
    const versionId = c.req.param('versionId')
    const version = await listed(design.id, versionId)
    const content = version && (await versionDesign(db, design.id, versionId))
    if (!version || !content) return c.json(error('No such version'), 404)
    const label = copyLabel(version)
    const name = input.name ?? `${design.name} (${label})`.slice(0, 120)
    return c.json(await createDesign(db, c.var.membership.workspaceId, design.brandId, name, content), 201)
  })

  app.get(`${PATH}/:versionId/thumbnail`, async (c) => {
    const design = await designOf(c)
    if (!design) return c.json(error('No such design'), 404)
    const { workspaceId } = c.var.membership
    const png = await versionPicture(db, storage, workspaceId, design.brandId, design.id, c.req.param('versionId'))
    if (!png) return c.json(error('This version has nothing to show'), 404)
    // A version's picture never changes once drawn: its id is never given to another.
    return c.body(new Uint8Array(png), 200, {
      'content-type': 'image/png',
      'cache-control': 'private, max-age=31536000, immutable',
    })
  })

  return app
}

function summaryOf(row: VersionRow): VersionSummary {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    description: row.description,
    savedBy: row.savedByName,
    takenAt: row.takenAt.toISOString(),
  }
}

/** What a version is called in a copy's name: its name; for a Before agent one, "Before " and the agent's name. */
function copyLabel(version: VersionRow): string {
  if (version.kind === 'named') return version.name
  if (version.kind === 'beforeAgent' && version.name) return `Before ${version.name}`
  return AUTOMATIC_NAMES[version.kind]
}
