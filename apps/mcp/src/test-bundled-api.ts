// A stand-in for the API's route that adds a bundled file to a brand's asset library, for tests: it keeps every picture
// sticker and illustration @dazbee/graphics lists, unless a test says they aren't stored yet, and gives a brand one
// asset per file however often it is added, its tags joining. An illustration's file is `TEST_SCENE_SVG`, whatever the
// illustration. It notes what it is sent and the assets it made.
import { Hono } from 'hono'

import { illustrations } from '@dazbee/graphics/illustrations'
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

/**
 * The file every bundled illustration is in the tests: a 400 × 300 scene painting with unDraw's accent (#6c63ff) as a
 * plain fill, a faded fill, a stroke and a gradient stop, beside a skin tone, a dark grey and the other sets' accent.
 */
export const TEST_SCENE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300">' +
  '<linearGradient id="sky"><stop offset="0" stop-color="#6C63FF"/><stop offset="1" stop-color="#ffffff"/></linearGradient>' +
  '<rect id="Sky" width="400" height="120" fill="url(#sky)"/>' +
  '<rect id="Parcel" x="40" y="160" width="120" height="100" fill="#6c63ff"/>' +
  '<circle id="Glow" cx="300" cy="200" r="60" fill="#6c63ff" fill-opacity="0.3"/>' +
  '<circle id="Head" cx="300" cy="150" r="20" fill="#ffb8b8"/>' +
  '<rect id="Body" x="280" y="170" width="40" height="90" fill="#2f2e41" stroke="#6c63ff" stroke-width="4"/>' +
  '<rect id="Badge" x="180" y="200" width="60" height="40" fill="#68e1fd"/></svg>'

/** The stand-in for `POST …/assets/from-bundle`. */
export function testBundled(now: () => number): TestBundled {
  const scene = { byteSize: new TextEncoder().encode(TEST_SCENE_SVG).length, width: 400, height: 300 }
  const pictures = new Map<string, { byteSize: number; width: number; height: number; contentType: string }>([
    ...stickerPictures().map((picture) => [picture.sha256, { ...picture, contentType: 'image/png' }] as const),
    ...illustrations().map((each) => [each.sha256, { ...scene, contentType: 'image/svg+xml' }] as const),
  ])
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
    const { byteSize, width, height, contentType } = picture
    const asset: AssetSummary = {
      id: `asset-bundled-${bundled.added.length + 1}`,
      brandId,
      sha256: input.sha256,
      contentType: contentType === 'image/png' ? 'image/png' : 'image/svg+xml',
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
