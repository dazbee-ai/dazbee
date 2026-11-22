// A stand-in for the API's route that adds a bundled file to a brand's asset library, for tests: it keeps every
// picture sticker, illustration and artwork file @dazbee/graphics lists, unless a test says they aren't stored yet,
// and gives a brand one asset per file however often it is added, its tags joining, its id holding the start of
// the file's SHA-256. An illustration's file is `TEST_SCENE_SVG`, an artwork SVG file `TEST_ART_SVG`, and a pattern's
// `TEST_TILE_SVG`, whatever the graphic (`bundledBytes`). It notes what it is sent and the assets it made.
import { Hono } from 'hono'

import { ARTWORK_SETS } from '@dazbee/graphics'
import { artworkFiles } from '@dazbee/graphics/artwork'
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

/**
 * The file every bundled artwork SVG file is in the tests: a 100 × 100 drawing painting with Streamline Plump's two
 * blues, Coolshapes' white and dddoodle's black written three ways, beside a colour no set swaps.
 */
export const TEST_ART_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">' +
  '<rect id="Body" width="60" height="60" fill="#2859c5"/>' +
  '<rect id="Light" x="10" y="10" width="20" height="20" fill="#8fbffa"/>' +
  '<circle id="Shape" cx="70" cy="70" r="20" fill="white"/>' +
  '<path id="Doodle" d="M0 90h40v4H0z" fill="#000"/>' +
  '<path id="Line" d="M0 98h40" stroke="black" stroke-width="2" fill="none"/>' +
  '<path id="Tip" d="M44 90h6v6h-6z" fill="currentColor"/>' +
  '<rect id="Spot" x="80" y="0" width="20" height="20" fill="#e4572e"/></svg>'

/** The tile every bundled pattern is in the tests: lines 10 apart, as Pattern Monster's download writes a tile. */
export const TEST_TILE_SVG =
  "<svg xmlns='http://www.w3.org/2000/svg' width='20' height='10'>" +
  "<rect x='0' y='0' width='100%' height='100%' fill='hsla(0,0%,100%,1)'/>" +
  "<path d='M0 5h20'  stroke-width='1' stroke='hsla(258.5,59.4%,59.4%,1)' fill='none'/></svg>"

/** How many of a file's SHA-256 digits a bundled asset's id holds. */
const ID_DIGITS = 16

/** What each bundled file is, by the start of its SHA-256: a scene, an artwork drawing or tile, or a picture. */
const KINDS = new Map<string, 'scene' | 'art' | 'tile' | 'picture'>([
  ...illustrations().map((each) => [each.sha256.slice(0, ID_DIGITS), 'scene'] as const),
  ...artworkFiles().map(({ set, sha256 }) => {
    const { format, kind } = ARTWORK_SETS[set]
    return [sha256.slice(0, ID_DIGITS), format === 'png' ? 'picture' : kind === 'background' ? 'tile' : 'art'] as const
  }),
])

/** The bytes the fake storage serves for a bundled asset, by its id, which holds the start of its SHA-256. */
export function bundledBytes(assetId: string): string {
  const start = /^asset-bundled-([0-9a-f]+)-/.exec(assetId)?.[1] ?? ''
  const kind = KINDS.get(start)
  return kind === 'art' ? TEST_ART_SVG : kind === 'tile' ? TEST_TILE_SVG : TEST_SCENE_SVG
}

/** The stand-in for `POST …/assets/from-bundle`. */
export function testBundled(now: () => number): TestBundled {
  const svg = (text: string, width: number, height: number) => ({
    byteSize: new TextEncoder().encode(text).length,
    width,
    height,
    contentType: 'image/svg+xml',
  })
  const pictures = new Map<string, { byteSize: number; width: number; height: number; contentType: string }>([
    ...stickerPictures().map((picture) => [picture.sha256, { ...picture, contentType: 'image/png' }] as const),
    ...illustrations().map((each) => [each.sha256, svg(TEST_SCENE_SVG, 400, 300)] as const),
    ...artworkFiles().map((file) => {
      const kind = KINDS.get(file.sha256.slice(0, ID_DIGITS))
      if (kind === 'picture') return [file.sha256, { ...file, contentType: 'image/png' }] as const
      return [file.sha256, kind === 'tile' ? svg(TEST_TILE_SVG, 20, 10) : svg(TEST_ART_SVG, 100, 100)] as const
    }),
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
      id: `asset-bundled-${input.sha256.slice(0, ID_DIGITS)}-${bundled.added.length + 1}`,
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
