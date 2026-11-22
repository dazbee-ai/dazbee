// The headers the web app's Next config sends: no other site may frame any page, so none can lay the Connect an
// agent page under its own and have Allow pressed, and that page names no referrer, so no address it leaves holds
// its sign-in request, and the fonts we ship and ONNX Runtime Web's files are kept for good. The Google faces' files are passed on to the
// API; with MCP_DEV_URL set, the MCP server's paths and an agent's upload links are too.
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

  it('has browsers and Cloudflare keep the fonts we ship and ONNX Runtime Web for good, and nothing else under /vendor/', async () => {
    const rules = (await config.headers?.()) ?? []
    const kept = ['/vendor/fonts/:file', '/vendor/onnxruntime/:version/:file']

    expect(rules.filter((rule) => rule.source.startsWith('/vendor/')).map((rule) => rule.source)).toEqual(kept)
    for (const source of kept)
      expect(rules.find((rule) => rule.source === source)?.headers).toEqual([
        { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
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

    it('passes only the Google faces’ files and the matchers’ files on to the API without MCP_DEV_URL', async () => {
      vi.stubEnv('MCP_DEV_URL', '')
      vi.stubEnv('API_URL', 'http://localhost:8787/')
      expect(await config.rewrites?.()).toEqual({
        beforeFiles: [
          { source: '/fonts/google/:path*', destination: 'http://localhost:8787/fonts/google/:path*' },
          { source: '/matchers/:path*', destination: 'http://localhost:8787/matchers/:path*' },
        ],
        afterFiles: [],
        fallback: [],
      })
    })
  })
})
