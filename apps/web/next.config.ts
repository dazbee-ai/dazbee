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
  // The Connect an agent page hands out access to designs: no other site may frame it, and no address it leaves
  // learns its sign-in request from the referrer.
  headers: async () => [
    {
      source: '/agents/connect',
      headers: [
        { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Referrer-Policy', value: 'no-referrer' },
      ],
    },
  ],
  // With MCP_DEV_URL set, the MCP server's paths go to it, so one base URL serves both, as Caddy does in production.
  rewrites: async () => {
    const mcp = process.env.MCP_DEV_URL?.replace(/\/+$/, '')
    if (!mcp) return []
    return {
      beforeFiles: [
        { source: '/mcp', destination: `${mcp}/mcp` },
        { source: '/oauth/:path*', destination: `${mcp}/oauth/:path*` },
        { source: '/.well-known/:doc(oauth-[^/]+)/:path*', destination: `${mcp}/.well-known/:doc/:path*` },
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
