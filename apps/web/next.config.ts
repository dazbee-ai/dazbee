import { join } from 'node:path'

import type { NextConfig } from 'next'

const config: NextConfig = {
  reactStrictMode: true,
  // The image runs the standalone server, traced from the repo's root so the workspace's packages come along.
  output: 'standalone',
  outputFileTracingRoot: join(import.meta.dirname, '..', '..'),
  // The commit the image is built from: a tab on an older build reloads rather than ask for chunks or actions this one lacks.
  ...(process.env.BUILD_ID ? { deploymentId: process.env.BUILD_ID } : {}),
  // next dev writes no AGENTS.md: the repo's own CLAUDE.md is the agents' guide.
  agentRules: false,
  experimental: {
    // next dev tells an agent to run `next upgrade` when the installed Next.js has a security advisory.
    agentUpgrade: 'security',
  },
  // No other site may frame a page of the app, so none can lay one under its own and have a button pressed, such
  // as Connect an agent's Allow. Every path takes it, since the rules match the address as written and a page
  // answers to its path written with escapes too. The Connect an agent page names no referrer, so no address it
  // leaves learns its sign-in request; its metadata says so in the page as well.
  headers: async () => [
    {
      source: '/:path*',
      headers: [
        { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
        { key: 'X-Frame-Options', value: 'DENY' },
      ],
    },
    { source: '/agents/connect', headers: [{ key: 'Referrer-Policy', value: 'no-referrer' }] },
    // The fonts we ship are pinned, as the offline worker takes them, so browsers and Cloudflare keep them for good.
    {
      source: '/vendor/fonts/:file',
      headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
    },
    // ONNX Runtime Web's files sit under their version, so a file at one address never changes.
    {
      source: '/vendor/onnxruntime/:version/:file',
      headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
    },
  ],
  // The Google faces' files and the matchers' files go to the API, and with MCP_DEV_URL set, the MCP server's paths go
  // to it and an agent's upload links to the API, so one base URL serves them all, as Caddy does in production.
  rewrites: async () => {
    const api = (process.env.API_URL ?? 'http://localhost:8787').replace(/\/+$/, '')
    const fonts = { source: '/fonts/google/:path*', destination: `${api}/fonts/google/:path*` }
    const matchers = { source: '/matchers/:path*', destination: `${api}/matchers/:path*` }
    const mcp = process.env.MCP_DEV_URL?.replace(/\/+$/, '')
    if (!mcp) return { beforeFiles: [fonts, matchers], afterFiles: [], fallback: [] }
    return {
      beforeFiles: [
        fonts,
        matchers,
        { source: '/mcp', destination: `${mcp}/mcp` },
        { source: '/oauth/:path*', destination: `${mcp}/oauth/:path*` },
        { source: '/.well-known/:doc(oauth-[^/]+)/:path*', destination: `${mcp}/.well-known/:doc/:path*` },
        { source: '/uploads/:token', destination: `${api}/uploads/:token` },
      ],
      afterFiles: [],
      fallback: [],
    }
  },
  turbopack: {
    resolveAlias: {
      fs: { browser: './lib/empty.ts' },
      path: { browser: './lib/empty.ts' },
    },
  },
}

export default config
