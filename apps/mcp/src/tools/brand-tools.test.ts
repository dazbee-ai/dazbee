import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
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

/** Every text block of a result after the first: its notes. */
function notesOf(result: CallToolResult): string[] {
  return result.content.slice(1).flatMap((block) => (block.type === 'text' ? [block.text] : []))
}

describe('brand_from_website', () => {
  it('fills the brand kit from the site, answering what it set and kept, and naming a font matched to another', async () => {
    const agent = await agentOf()
    const result = await agent.call('brand_from_website', { brand: 'brand-winter', link: 'northwind.example' })
    expect(result.isError).toBeFalsy()
    expect(JSON.parse(textOf(result))).toEqual({
      site: 'https://northwind.example/',
      filled: ['logo', 'primary', 'secondary', 'background', 'text', 'body'],
      kept: ['heading'],
      colors: { primary: '#4338CAFF', secondary: '#F59E0BFF', background: '#FFFFFFFF', text: '#111827FF' },
      fonts: [
        { role: 'heading', site: 'Meridian Display', family: 'Playfair Display', match: 'closest' },
        { role: 'body', site: 'Inter', family: 'Inter', match: 'same' },
      ],
      logo: { id: 'asset-site-logo', name: 'Northwind Studio logo' },
      otherLogo: 'https://northwind.example/apple-touch-icon.png',
      shareImage: null,
    })
    expect(notesOf(result)).toEqual([
      'The site’s heading font, Meridian Display, isn’t one Dazbee has; the closest in its catalog is Playfair Display. Tell the person, as they may want to upload their own font.',
      'The kit already sets heading, so it was kept; call again with replace: true only if the person asks to replace it.',
      'Dazbee couldn’t read 1 of the site’s 2 style sheets, so some of its colours and fonts may be missing.',
    ])
    expect(server.api.fromWebsite()).toEqual([{ brandId: 'brand-winter', url: 'northwind.example' }])
  })

  it('sends replace when asked', async () => {
    const agent = await agentOf()
    await agent.call('brand_from_website', { brand: 'brand-winter', link: 'https://northwind.example', replace: true })
    expect(server.api.fromWebsite()).toEqual([
      { brandId: 'brand-winter', url: 'https://northwind.example', replace: true },
    ])
  })

  it('tells a site that turns Dazbee away as the API’s sentence', async () => {
    const agent = await agentOf()
    const result = await agent.call('brand_from_website', { brand: 'brand-winter', link: 'https://walled.example' })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toBe(
      'walled.example turned Dazbee away (403): it lets only people in a browser read it, so Dazbee can’t; ask the person for their logo, brand colours and fonts instead.',
    )
  })

  it('tells an access that only views that it can’t change the kit, changing nothing', async () => {
    const agent = await agentOf({ writes: false })
    const result = await agent.call('brand_from_website', { brand: 'brand-winter', link: 'northwind.example' })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toMatch(/^This agent can’t change the brand kit: its access only views/)
    expect(server.api.fromWebsite()).toEqual([])
  })

  it('refuses an unknown argument, naming the ones it takes', async () => {
    const agent = await agentOf()
    const result = await agent.call('brand_from_website', { brand: 'brand-winter', url: 'northwind.example' })
    expect(textOf(result)).toBe('Unknown argument `url` (brand_from_website takes brand, link, replace).')
  })
})
