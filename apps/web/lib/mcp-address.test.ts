import { describe, expect, it } from 'vitest'

import { mcpAddress } from './mcp-address.ts'

/** A request's headers, as `headers()` gives them. */
const asked = (fields: Record<string, string>) => new Headers(fields)

describe('mcpAddress', () => {
  it('is /mcp at the public base URL PUBLIC_URL names, whatever host the request names', () => {
    const pilot = asked({ host: 'pilot.example.com', 'x-forwarded-proto': 'https' })
    expect(mcpAddress(pilot, 'https://app.example.com')).toBe('https://app.example.com/mcp')
    expect(mcpAddress(pilot, ' https://app.example.com/ ')).toBe('https://app.example.com/mcp')
    expect(mcpAddress(asked({}), 'https://app.example.com')).toBe('https://app.example.com/mcp')
  })

  it('with no PUBLIC_URL, is /mcp on the host the person reached, over https behind a proxy', () => {
    expect(mcpAddress(asked({ host: 'app.example.com', 'x-forwarded-proto': 'https' }))).toBe(
      'https://app.example.com/mcp',
    )
  })

  it('takes the host and protocol the proxy saw first, before its own', () => {
    expect(
      mcpAddress(
        asked({
          host: 'router:3000',
          'x-forwarded-host': 'app.example.com, router:3000',
          'x-forwarded-proto': 'https, http',
        }),
      ),
    ).toBe('https://app.example.com/mcp')
  })

  it('is over http with no proxy, as a local copy runs, with its port', () => {
    expect(mcpAddress(asked({ host: 'localhost:3153' }))).toBe('http://localhost:3153/mcp')
  })

  it('is null for a host that is no host', () => {
    expect(mcpAddress(asked({ host: 'evil.example/path?x=' }))).toBeNull()
    expect(mcpAddress(asked({ host: 'user@evil.example' }))).toBeNull()
    expect(mcpAddress(asked({}))).toBeNull()
  })
})
