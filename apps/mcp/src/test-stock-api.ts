// A stand-in for the API's stock photo routes, for tests: one photo found for any words but "nothing", the search
// "busy" turned away as past Pixabay's limit a minute, the photo of id 500 failing to download, and both routes
// saying stock search is off once a test turns it off. It notes the searches and saves it is sent.
import { Hono } from 'hono'

import {
  AddStockPhoto,
  type AgentMe,
  type AssetSummary,
  STOCK_SOURCE,
  type StockPhoto,
  StockSearch,
} from '@dazbee/schema'

/** The stand-in's routes, and what they were sent. */
export interface TestStock {
  /** The routes, mounted on the fake API below its access, workspace and brand checks. */
  app: Hono<{ Variables: { agent: AgentMe } }>
  /** Whether stock search is off, as on a server without a Pixabay key. */
  off: boolean
  /** The searches sent, in order. */
  searches: StockSearch[]
  /** The photos saved, each its brand and id, in order. */
  saved: { brandId: string; id: number }[]
}

/** The one photo every search finds. */
const PHOTO: StockPhoto = {
  id: 101,
  preview: 'https://cdn.pixabay.com/photo/101_150.jpg',
  width: 1280,
  height: 853,
  photographer: 'Anna_K',
  tags: ['red shoe', 'sneaker'],
  page: 'https://pixabay.com/photos/101/',
}
/** What both routes answer while stock search is off. */
const OFF =
  'Stock photo search is off on this Dazbee server (it has no Pixabay key), so trying again won’t help; use pictures from links or the brand’s own images instead'

/** The stand-in's routes, with the clock saved photos are stamped by. */
export function testStock(now: () => number): TestStock {
  const app = new Hono<{ Variables: { agent: AgentMe } }>()
  const stock: TestStock = { app, off: false, searches: [], saved: [] }

  app.get('/workspaces/:workspaceId/stock/photos', (c) => {
    if (!c.var.agent.writes) return c.json({ error: 'Only an Owner, Admin or Editor can do this' }, 403)
    if (stock.off) return c.json({ error: OFF }, 503)
    const search = StockSearch.safeParse(c.req.query())
    if (!search.success) return c.json({ error: 'q: give 1 to 100 characters' }, 400)
    stock.searches.push(search.data)
    if (search.data.q === 'busy')
      return c.json(
        {
          error:
            'Dazbee has searched Pixabay as often as it may for now (100 times a minute, as Pixabay asks); try again in a minute',
        },
        429,
      )
    return c.json({ source: STOCK_SOURCE, photos: search.data.q === 'nothing' ? [] : [PHOTO] })
  })

  app.post('/workspaces/:workspaceId/brands/:brandId/assets/from-stock', async (c) => {
    if (!c.var.agent.writes) return c.json({ error: 'Only an Owner, Admin or Editor can do this' }, 403)
    if (stock.off) return c.json({ error: OFF }, 503)
    const input = AddStockPhoto.safeParse(await c.req.json())
    if (!input.success) return c.json({ error: 'id: give a whole number' }, 400)
    const { id } = input.data
    if (id === 500)
      return c.json(
        { error: `Dazbee couldn’t download Pixabay’s photo ${id}; try again in a moment, or pick another photo` },
        502,
      )
    stock.saved.push({ brandId: c.req.param('brandId'), id })
    const asset: AssetSummary = {
      id: `asset-stock-${id}`,
      brandId: c.req.param('brandId'),
      sha256: 'd'.repeat(64),
      contentType: 'image/jpeg',
      byteSize: 200_000,
      width: PHOTO.width,
      height: PHOTO.height,
      name: 'Red shoe, sneaker',
      tags: ['stock', 'pixabay', PHOTO.photographer.toLowerCase()],
      createdAt: new Date(now()).toISOString(),
    }
    return c.json(asset, 201)
  })

  return stock
}
