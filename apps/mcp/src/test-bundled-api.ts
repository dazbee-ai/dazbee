// A stand-in for the API's route that adds a bundled file to a brand's asset library, for tests: it keeps every picture
// sticker @dazbee/graphics lists, unless a test says they aren't stored yet, and gives a brand one asset per file
// however often it is added, its tags joining. It notes what it is sent and the assets it made.
import { Hono } from 'hono'

import { stickerPictures } from '@dazbee/graphics/pictures'
import { AddBundledAsset, type AgentMe, type AssetSummary } from '@dazbee/schema'

/** The stand-in's route, and what it was sent and made. */
export interface TestBundled {
  /** The route, mounted on the fake API below its access, workspace and brand checks. */
  app: Hono<{ Variables: { agent: AgentMe } }>
  /** Whether the bundled files are stored, as they are once `stickers:upload` has run. */
  stored: boolean
  /** The bodies sent, each with its brand, in order. */
  asked: ({ brandId: string } & AddBundledAsset)[]
  /** The assets made, in order. */
  added: AssetSummary[]
}

/** The stand-in for `POST …/assets/from-bundle`. */
export function testBundled(now: () => number): TestBundled {
  const pictures = new Map(stickerPictures().map((picture) => [picture.sha256, picture]))
  const app = new Hono<{ Variables: { agent: AgentMe } }>()
  const bundled: TestBundled = { app, stored: true, asked: [], added: [] }

  app.post('/workspaces/:workspaceId/brands/:brandId/assets/from-bundle', async (c) => {
    if (!c.var.agent.writes) return c.json({ error: 'Only an Owner, Admin or Editor can do this' }, 403)
    const input = AddBundledAsset.parse(await c.req.json())
    const brandId = c.req.param('brandId')
    bundled.asked.push({ brandId, ...input })
    const picture = pictures.get(input.sha256)
    if (!picture || !bundled.stored)
      return c.json({ error: 'Dazbee keeps no bundled file with that SHA-256; it may not be stored yet' }, 404)
    const known = bundled.added.find((asset) => asset.brandId === brandId && asset.sha256 === input.sha256)
    const tags = [...new Set([...(known?.tags ?? []), ...(input.tags ?? [])])]
    if (known) return c.json(Object.assign(known, { tags }), 201)
    const { sha256, byteSize, width, height } = picture
    const asset: AssetSummary = {
      id: `asset-bundled-${bundled.added.length + 1}`,
      brandId,
      sha256,
      contentType: 'image/png',
      byteSize,
      width,
      height,
      name: input.name,
      tags,
      createdAt: new Date(now()).toISOString(),
    }
    bundled.added.push(asset)
    return c.json(asset, 201)
  })

  return bundled
}
