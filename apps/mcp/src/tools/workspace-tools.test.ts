import { afterEach, describe, expect, it } from 'vitest'

import { type TestServer, testServer, textOf } from '../test-client.ts'

let server: TestServer

afterEach(async () => {
  await server.endpoint.close()
})

/** A client of an access with `options`, connected to a new server. */
async function agentOf(options?: Parameters<TestServer['api']['addAccess']>[0]) {
  server = testServer()
  return server.connect(server.api.addAccess(options).token())
}

describe('list_brands', () => {
  it('lists the access’s brands by id and name', async () => {
    const agent = await agentOf()
    expect(await agent.json('list_brands')).toEqual([
      { id: 'brand-summer', name: 'Summer sale' },
      { id: 'brand-winter', name: 'Winter' },
    ])
  })

  it('lists only the brands an access limited to some may open', async () => {
    const agent = await agentOf({ brandIds: ['brand-winter'] })
    expect(await agent.json('list_brands')).toEqual([{ id: 'brand-winter', name: 'Winter' }])
  })

  it('refuses an unknown argument, saying it takes none', async () => {
    const agent = await agentOf()
    const result = await agent.call('list_brands', { brand: 'brand-summer' })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toBe('Unknown argument `brand` (list_brands takes none).')
  })
})

describe('list_designs', () => {
  it('lists the brand’s designs with their id, name and when they were changed', async () => {
    const agent = await agentOf()
    expect(await agent.json('list_designs', { brand: 'brand-summer' })).toEqual([
      { id: 'design-launch', name: 'Launch', updated: '2026-11-20T10:30:00.000Z' },
    ])
  })

  it('refuses unknown arguments, naming the ones it takes', async () => {
    const agent = await agentOf()
    const result = await agent.call('list_designs', { brand: 'brand-summer', page: 2, sort: 'name' })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toBe('Unknown arguments `page`, `sort` (list_designs takes brand).')
  })

  it('tells a missing brand, and one that is not an id, as tool errors', async () => {
    const agent = await agentOf()
    const missing = await agent.call('list_designs')
    expect(missing.isError).toBe(true)
    expect(textOf(missing)).toBe('`brand` is required.')
    const path = await agent.call('list_designs', { brand: '../admin' })
    expect(path.isError).toBe(true)
    expect(textOf(path)).toContain('`brand`')
  })

  it('tells a brand outside the access as the API’s refusal', async () => {
    const agent = await agentOf({ brandIds: ['brand-winter'] })
    const result = await agent.call('list_designs', { brand: 'brand-summer' })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toBe('No such brand.')
  })
})

describe('list_assets', () => {
  it('lists the brand’s images with their id, name, tags, type and size', async () => {
    const agent = await agentOf()
    expect(await agent.json('list_assets', { brand: 'brand-summer' })).toEqual([
      { id: 'asset-logo', name: 'Logo', tags: ['logo'], type: 'image/svg+xml', width: 400, height: 120 },
      { id: 'asset-bottle', name: 'Bottle', tags: ['product', 'summer'], type: 'image/png', width: 1600, height: 2400 },
      { id: 'asset-mark', name: 'Mark', tags: ['brand'], type: 'image/png', width: 400, height: 400 },
      { id: 'asset-card', name: 'Card', tags: ['card'], type: 'image/svg+xml', width: 400, height: 300 },
    ])
  })

  it('keeps those the query finds by name or tag', async () => {
    const agent = await agentOf()
    const found = (await agent.json('list_assets', { brand: 'brand-summer', query: 'product' })) as { id: string }[]
    expect(found.map(({ id }) => id)).toEqual(['asset-bottle'])
  })

  it('refuses an unknown argument, naming the ones it takes', async () => {
    const agent = await agentOf()
    const result = await agent.call('list_assets', { brand: 'brand-summer', tag: 'logo' })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toBe('Unknown argument `tag` (list_assets takes brand, query).')
  })
})

describe('create_design', () => {
  it('makes a design in the brand and answers its id', async () => {
    const agent = await agentOf()
    const made = (await agent.json('create_design', { brand: 'brand-winter', name: 'Holiday ad' })) as { id: string }
    expect(made).toEqual({ id: made.id, name: 'Holiday ad' })
    expect(server.api.designsOf('brand-winter').map(({ id }) => id)).toContain(made.id)
  })

  it('tells the agent to open the design and read the ad rules for each size next', async () => {
    const agent = await agentOf()
    const result = await agent.call('create_design', { brand: 'brand-winter', name: 'Holiday ad' })
    const [, note] = result.content
    expect(note?.type === 'text' ? note.text : '').toMatch(/open_design.*ad_rules/)
  })

  it('tells a view access’s refusal (403) as a tool error', async () => {
    const agent = await agentOf({ writes: false })
    const result = await agent.call('create_design', { brand: 'brand-winter', name: 'Holiday ad' })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toMatch(/may only view designs/)
    expect(server.api.designsOf('brand-winter')).toHaveLength(1)
  })

  it('refuses an unknown argument, naming the ones it takes', async () => {
    const agent = await agentOf()
    const result = await agent.call('create_design', { brand: 'brand-winter', name: 'Ad', size: '1080x1080' })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toBe('Unknown argument `size` (create_design takes brand, name).')
  })

  it('tells a blank name as a tool error', async () => {
    const agent = await agentOf()
    const result = await agent.call('create_design', { brand: 'brand-winter', name: '   ' })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toMatch(/^`name`: /)
  })
})

describe('add_image', () => {
  it('adds the picture at a link to the brand’s images and answers it as list_assets does', async () => {
    const agent = await agentOf()
    const added = await agent.json('add_image', {
      brand: 'brand-winter',
      link: 'https://shop.example/boots.png',
      name: 'Boots',
      tags: ['product'],
    })
    expect(added).toEqual({
      id: 'asset-from-url-1',
      name: 'Boots',
      tags: ['product'],
      type: 'image/png',
      width: 640,
      height: 480,
    })
    expect(server.api.addedFromUrl()).toEqual([
      { brandId: 'brand-winter', url: 'https://shop.example/boots.png', name: 'Boots', tags: ['product'] },
    ])
  })

  it('sends only the link when no name or tags are given', async () => {
    const agent = await agentOf()
    await agent.json('add_image', { brand: 'brand-winter', link: 'https://shop.example/boots.png' })
    expect(server.api.addedFromUrl()).toEqual([{ brandId: 'brand-winter', url: 'https://shop.example/boots.png' }])
  })

  it('tells the API’s refusal of the link as its sentence', async () => {
    const agent = await agentOf()
    const result = await agent.call('add_image', { brand: 'brand-winter', link: 'https://inside.example/a.png' })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toBe(
      'Dazbee fetches only from public websites, and inside.example is a private or local address.',
    )
  })

  it('tells a view access’s refusal (403) as a tool error, adding nothing', async () => {
    const agent = await agentOf({ writes: false })
    const result = await agent.call('add_image', { brand: 'brand-winter', link: 'https://shop.example/boots.png' })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toMatch(/may only view designs, so it can’t add an image/)
    expect(server.api.addedFromUrl()).toEqual([])
  })

  it('tells a brand outside the access as the API’s refusal', async () => {
    const agent = await agentOf({ brandIds: ['brand-winter'] })
    const result = await agent.call('add_image', { brand: 'brand-summer', link: 'https://shop.example/boots.png' })
    expect(textOf(result)).toBe('No such brand.')
  })

  it('refuses an unknown argument, naming the ones it takes, and a tag that is too long', async () => {
    const agent = await agentOf()
    const unknown = await agent.call('add_image', { brand: 'brand-winter', link: 'https://a.example/a.png', url: 'x' })
    expect(textOf(unknown)).toBe('Unknown argument `url` (add_image takes brand, link, name, tags).')
    const long = await agent.call('add_image', {
      brand: 'brand-winter',
      link: 'https://a.example/a.png',
      tags: ['x'.repeat(41)],
    })
    expect(long.isError).toBe(true)
    expect(textOf(long)).toMatch(/^`tags.0`: /)
  })
})

describe('upload_image', () => {
  it('answers a one-time link on Dazbee’s public address for the brand, name and type, and how to send the file', async () => {
    const agent = await agentOf()
    const result = await agent.call('upload_image', {
      brand: 'brand-winter',
      name: 'Studio shot',
      type: 'image/jpeg',
      tags: ['product'],
    })
    expect(JSON.parse(textOf(result))).toEqual({
      link: 'https://app.test/uploads/test-token-1',
      expires: '2026-11-21T00:10:00.000Z',
      maxBytes: 31_457_280,
      send: "curl -sS -T '<path of the file>' 'https://app.test/uploads/test-token-1'",
    })
    const [, note] = result.content
    expect(note?.type === 'text' && note.text).toMatch(
      /^Send the file once, within 10 minutes: its answer is the image/,
    )
    expect(server.api.uploadLinks()).toEqual([
      { brandId: 'brand-winter', contentType: 'image/jpeg', name: 'Studio shot', tags: ['product'] },
    ])
  })

  it('gives an SVG file’s link the SVG limit', async () => {
    const agent = await agentOf()
    const answer = await agent.json('upload_image', { brand: 'brand-winter', name: 'Logo', type: 'image/svg+xml' })
    expect(answer).toMatchObject({ maxBytes: 5_000_000 })
  })

  it('tells a view access’s refusal (403) as a tool error, asking for no link', async () => {
    const agent = await agentOf({ writes: false })
    const result = await agent.call('upload_image', { brand: 'brand-winter', name: 'Shot', type: 'image/png' })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toMatch(/may only view designs, so it can’t upload an image/)
    expect(server.api.uploadLinks()).toEqual([])
  })

  it('tells a brand outside the access as the API’s refusal', async () => {
    const agent = await agentOf({ brandIds: ['brand-winter'] })
    const result = await agent.call('upload_image', { brand: 'brand-summer', name: 'Shot', type: 'image/png' })
    expect(textOf(result)).toBe('No such brand.')
  })

  it('refuses a type Dazbee doesn’t take and a missing name, naming the field', async () => {
    const agent = await agentOf()
    const gif = await agent.call('upload_image', { brand: 'brand-winter', name: 'Shot', type: 'image/gif' })
    expect(gif.isError).toBe(true)
    expect(textOf(gif)).toMatch(/^`type`: /)
    const unnamed = await agent.call('upload_image', { brand: 'brand-winter', type: 'image/png' })
    expect(textOf(unnamed)).toBe('`name` is required.')
  })
})
