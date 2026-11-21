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
