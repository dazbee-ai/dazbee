// The headers the web app's Next config sends: no other site may frame any page, so none can lay the Connect an
// agent page under its own and have Allow pressed, and that page names no referrer, so no address it leaves holds
// its sign-in request. With MCP_DEV_URL set, the MCP server's paths and an agent's upload links are passed on.
import { afterEach, describe, expect, it, vi } from 'vitest'

import config from './next.config.ts'

describe('config', () => {
  it('forbids framing on every path, however the address is written', async () => {
    const rules = (await config.headers?.()) ?? []

    expect(rules.find((rule) => rule.source === '/:path*')?.headers).toEqual([
      { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
      { key: 'X-Frame-Options', value: 'DENY' },
    ])
  })

  it('sends no referrer from the Connect an agent page', async () => {
    const rules = (await config.headers?.()) ?? []

    expect(rules.find((rule) => rule.source === '/agents/connect')?.headers).toEqual([
      { key: 'Referrer-Policy', value: 'no-referrer' },
    ])
  })

  describe('rewrites', () => {
    afterEach(() => {
      vi.unstubAllEnvs()
    })

    it('passes an agent’s upload links on to the API beside the MCP server’s paths', async () => {
      vi.stubEnv('MCP_DEV_URL', 'http://localhost:3100/')
      vi.stubEnv('API_URL', 'http://localhost:8787')
      const rewrites = await config.rewrites?.()
      const before = rewrites && !Array.isArray(rewrites) ? rewrites.beforeFiles : []
      expect(before).toContainEqual({ source: '/mcp', destination: 'http://localhost:3100/mcp' })
      expect(before).toContainEqual({ source: '/uploads/:token', destination: 'http://localhost:8787/uploads/:token' })
    })

    it('passes nothing on without MCP_DEV_URL', async () => {
      vi.stubEnv('MCP_DEV_URL', '')
      expect(await config.rewrites?.()).toEqual([])
    })
  })
})
