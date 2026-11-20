// The headers the web app sends with the Connect an agent page, read from its Next config: no other site may frame
// the page, so no one can lay it under their own and have Allow pressed, and no address it leaves holds its request.
import { describe, expect, it } from 'vitest'

import config from '@/next.config.ts'

describe('the Connect an agent page’s headers', () => {
  it('forbids framing and sends no referrer', async () => {
    const rules = (await config.headers?.()) ?? []
    const page = rules.find((rule) => rule.source === '/agents/connect')

    expect(page?.headers).toEqual(
      expect.arrayContaining([
        { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Referrer-Policy', value: 'no-referrer' },
      ]),
    )
  })
})
