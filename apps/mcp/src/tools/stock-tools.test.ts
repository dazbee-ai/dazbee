import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { afterEach, describe, expect, it } from 'vitest'

import { type TestServer, testServer, textOf } from '../test-client.ts'

let server: TestServer

afterEach(async () => {
  await server.endpoint.close()
})

/** The text of each of the answer's blocks. */
function texts(result: CallToolResult): string[] {
  return result.content.map((block) => (block.type === 'text' ? block.text : ''))
}

/** A client of an access with `options`, connected to a new server. */
async function agentOf(options?: Parameters<TestServer['api']['addAccess']>[0]) {
  server = testServer()
  return server.connect(server.api.addAccess(options).token())
}

describe('search_stock', () => {
  it('answers the photos Pixabay finds, naming Pixabay as their source, and says how to save one', async () => {
    const agent = await agentOf()
    const result = await agent.call('search_stock', { query: 'red shoe', orientation: 'landscape', colour: 'red' })
    expect(result.isError).toBeFalsy()
    expect(JSON.parse(texts(result)[0] ?? '')).toEqual({
      source: 'Pixabay',
      photos: [
        {
          id: 101,
          preview: 'https://cdn.pixabay.com/photo/101_150.jpg',
          width: 1280,
          height: 853,
          photographer: 'Anna_K',
          tags: ['red shoe', 'sneaker'],
          page: 'https://pixabay.com/photos/101/',
        },
      ],
    })
    expect(texts(result)[1]).toMatch(/^Photos from Pixabay \(pixabay\.com\)\. add_stock saves one/)
    expect(server.api.stock.searches).toEqual([{ q: 'red shoe', orientation: 'landscape', colour: 'red' }])
  })

  it('sends only the words when no orientation or colour is given', async () => {
    const agent = await agentOf()
    await agent.call('search_stock', { query: 'shoe' })
    expect(server.api.stock.searches).toEqual([{ q: 'shoe' }])
  })

  it('says so when Pixabay finds nothing', async () => {
    const agent = await agentOf()
    const result = await agent.call('search_stock', { query: 'nothing' })
    expect(result.isError).toBeFalsy()
    expect(textOf(result)).toBe('Pixabay has no photo for “nothing”; try fewer or other words, in English')
  })

  it('says stock search is off when the server has no Pixabay key', async () => {
    const agent = await agentOf()
    server.api.stock.off = true
    const result = await agent.call('search_stock', { query: 'shoe' })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toMatch(/^Stock photo search is off on this Dazbee server/)
  })

  it('tells the API’s refusal, such as Pixabay’s limit a minute, as its sentence', async () => {
    const agent = await agentOf()
    const result = await agent.call('search_stock', { query: 'busy' })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toMatch(/^Dazbee has searched Pixabay as often as it may for now/)
  })

  it('tells a view access’s refusal (403) as a tool error, searching nothing', async () => {
    const agent = await agentOf({ writes: false })
    const result = await agent.call('search_stock', { query: 'shoe' })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toMatch(/may only view designs, so it can’t search stock photos/)
    expect(server.api.stock.searches).toEqual([])
  })

  it('refuses a colour Pixabay doesn’t know, and a search past 100 characters', async () => {
    const agent = await agentOf()
    expect((await agent.call('search_stock', { query: 'shoe', colour: 'mauve' })).isError).toBe(true)
    expect((await agent.call('search_stock', { query: 'x'.repeat(101) })).isError).toBe(true)
    expect(server.api.stock.searches).toEqual([])
  })
})

describe('add_stock', () => {
  it('saves a photo into the brand’s images and answers it as list_assets does, with how to place it', async () => {
    const agent = await agentOf()
    const result = await agent.call('add_stock', { brand: 'brand-winter', id: 101 })
    expect(result.isError).toBeFalsy()
    expect(JSON.parse(texts(result)[0] ?? '')).toEqual({
      id: 'asset-stock-101',
      name: 'Red shoe, sneaker',
      tags: ['stock', 'pixabay', 'anna_k'],
      type: 'image/jpeg',
      width: 1280,
      height: 853,
    })
    expect(texts(result)[1]).toMatch(/^Saved from Pixabay\b.*place_asset/)
    expect(server.api.stock.saved).toEqual([{ brandId: 'brand-winter', id: 101 }])
  })

  it('tells a failed download as the API’s sentence', async () => {
    const agent = await agentOf()
    const result = await agent.call('add_stock', { brand: 'brand-winter', id: 500 })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toBe(
      'Dazbee couldn’t download Pixabay’s photo 500; try again in a moment, or pick another photo.',
    )
  })

  it('says stock search is off when the server has no Pixabay key', async () => {
    const agent = await agentOf()
    server.api.stock.off = true
    const result = await agent.call('add_stock', { brand: 'brand-winter', id: 101 })
    expect(textOf(result)).toMatch(/^Stock photo search is off on this Dazbee server/)
  })

  it('tells a view access’s refusal (403) as a tool error, saving nothing', async () => {
    const agent = await agentOf({ writes: false })
    const result = await agent.call('add_stock', { brand: 'brand-winter', id: 101 })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toMatch(/may only view designs, so it can’t save a stock photo/)
    expect(server.api.stock.saved).toEqual([])
  })

  it('refuses an id that is not a whole number', async () => {
    const agent = await agentOf()
    const result = await agent.call('add_stock', { brand: 'brand-winter', id: '101' })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toMatch(/^`id`: /)
  })
})
