// The headers the web app's Next config sends: no other site may frame any page, so none can lay the Connect an
// agent page under its own and have Allow pressed, and that page names no referrer, so no address it leaves holds
// its sign-in request.
import { describe, expect, it } from 'vitest'

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
})
