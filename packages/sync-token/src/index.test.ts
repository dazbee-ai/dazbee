import { createHmac } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import {
  signSyncToken,
  SYNC_AGENT_CHARS,
  SYNC_NAME_CHARS,
  SYNC_TOKEN_TTL_MS,
  syncTokenSecret,
  verifySyncToken,
} from './index.ts'

const secret = 'a'.repeat(32)
const who = {
  designId: 'design-1',
  workspaceId: 'workspace-1',
  userId: 'user-1',
  role: 'editor',
  schemaVersion: 1,
  name: 'Ann Archer',
} as const

/** A token signed with `secret` for any payload, as a forger with the key would write it. */
function signed(payload: Record<string, unknown>) {
  const text = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${text}.${createHmac('sha256', secret).update(text).digest('base64url')}`
}

describe('syncTokenSecret', () => {
  it('needs a secret of at least 32 characters from the environment', () => {
    expect(() => syncTokenSecret({})).toThrow('SYNC_TOKEN_SECRET')
    expect(() => syncTokenSecret({ SYNC_TOKEN_SECRET: 'short' })).toThrow('SYNC_TOKEN_SECRET')
    expect(syncTokenSecret({ SYNC_TOKEN_SECRET: secret })).toBe(secret)
  })
})

describe('signSyncToken', () => {
  it('accepts a fresh token for its design', () => {
    const { token, expiresAt } = signSyncToken(secret, who, 1_000)
    expect(expiresAt).toBe(1_000 + SYNC_TOKEN_TTL_MS)
    expect(verifySyncToken(secret, token, 'design-1', 2_000)).toEqual({ ok: true, payload: { ...who, expiresAt } })
  })
})

describe('verifySyncToken', () => {
  it('refuses an expired token', () => {
    const { token, expiresAt } = signSyncToken(secret, who, 1_000)
    expect(verifySyncToken(secret, token, 'design-1', expiresAt)).toEqual({ ok: false, reason: 'expired token' })
  })

  it('refuses a token for another design', () => {
    const { token } = signSyncToken(secret, who)
    expect(verifySyncToken(secret, token, 'design-2')).toEqual({ ok: false, reason: 'token for another design' })
  })

  it('refuses a token signed with another secret, or changed after signing', () => {
    const { token } = signSyncToken('b'.repeat(32), who)
    expect(verifySyncToken(secret, token, 'design-1')).toEqual({ ok: false, reason: 'bad signature' })
    const [, signature] = signSyncToken(secret, who).token.split('.')
    const forged = `${Buffer.from(JSON.stringify({ ...who, designId: 'design-2', expiresAt: Date.now() + 1e6 })).toString('base64url')}.${signature}`
    expect(verifySyncToken(secret, forged, 'design-2')).toEqual({ ok: false, reason: 'bad signature' })
  })

  it('refuses a token without a role, or with one no member has', () => {
    for (const role of [undefined, 'guest', 3]) {
      const text = Buffer.from(JSON.stringify({ ...who, role, expiresAt: Date.now() + 1e6 })).toString('base64url')
      const token = `${text}.${createHmac('sha256', secret).update(text).digest('base64url')}`
      expect(verifySyncToken(secret, token, 'design-1')).toEqual({ ok: false, reason: 'token without a role' })
    }
  })

  it('refuses a token without the design’s schema version, a whole number from 1', () => {
    for (const schemaVersion of [undefined, 0, -1, 1.5, '1', null]) {
      const text = Buffer.from(JSON.stringify({ ...who, schemaVersion, expiresAt: Date.now() + 1e6 })).toString(
        'base64url',
      )
      const token = `${text}.${createHmac('sha256', secret).update(text).digest('base64url')}`
      expect(verifySyncToken(secret, token, 'design-1')).toEqual({
        ok: false,
        reason: 'token without a schema version',
      })
    }
  })

  it('trusts a token no further than one token lifetime from now, whatever expiry it carries', () => {
    const { token } = signSyncToken(secret, who, 50_000_000)
    expect(verifySyncToken(secret, token, 'design-1', 2_000)).toEqual({
      ok: true,
      payload: { ...who, expiresAt: 2_000 + SYNC_TOKEN_TTL_MS },
    })
  })

  it("carries the member's name, which other tabs show; a token from before names had none", () => {
    const { token } = signSyncToken(secret, who)
    expect(verifySyncToken(secret, token, 'design-1')).toMatchObject({ ok: true, payload: { name: 'Ann Archer' } })
    const old = signed({ ...who, name: undefined, expiresAt: Date.now() + 1e6 })
    expect(verifySyncToken(secret, old, 'design-1')).toMatchObject({ ok: true, payload: { name: '' } })
  })

  it('refuses a name that is not text, and cuts a long one to its limit', () => {
    for (const name of [3, null, { first: 'Ann' }]) {
      const token = signed({ ...who, name, expiresAt: Date.now() + 1e6 })
      expect(verifySyncToken(secret, token, 'design-1')).toEqual({ ok: false, reason: 'token with a name not text' })
    }
    const long = 'n'.repeat(SYNC_NAME_CHARS + 50)
    expect(
      verifySyncToken(secret, signed({ ...who, name: long, expiresAt: Date.now() + 1e6 }), 'design-1'),
    ).toMatchObject({
      ok: true,
      payload: { name: long.slice(0, SYNC_NAME_CHARS) },
    })
    const smiles = '😀'.repeat(SYNC_NAME_CHARS + 1)
    expect(
      verifySyncToken(secret, signed({ ...who, name: smiles, expiresAt: Date.now() + 1e6 }), 'design-1'),
    ).toMatchObject({
      ok: true,
      payload: { name: '😀'.repeat(SYNC_NAME_CHARS) },
    })
    const { token } = signSyncToken(secret, { ...who, name: long })
    expect(JSON.parse(Buffer.from(token.split('.')[0] as string, 'base64url').toString()).name).toHaveLength(
      SYNC_NAME_CHARS,
    )
  })

  it("carries an agent's name for an agent's tab, cut to its limit; a token without one reads as before", () => {
    const { token } = signSyncToken(secret, { ...who, agent: 'Claude Code (agent)' })
    expect(verifySyncToken(secret, token, 'design-1')).toMatchObject({
      ok: true,
      payload: { ...who, agent: 'Claude Code (agent)' },
    })
    const long = signSyncToken(secret, { ...who, agent: 'a'.repeat(100) }).token
    expect(JSON.parse(Buffer.from(long.split('.')[0] as string, 'base64url').toString()).agent).toBe(
      'a'.repeat(SYNC_AGENT_CHARS),
    )
    expect(SYNC_AGENT_CHARS).toBe(64)
    const forged = signed({ ...who, agent: '😀'.repeat(70), expiresAt: Date.now() + 1e6 })
    expect(verifySyncToken(secret, forged, 'design-1')).toMatchObject({
      ok: true,
      payload: { agent: '😀'.repeat(64) },
    })
    const plain = verifySyncToken(secret, signSyncToken(secret, who).token, 'design-1')
    expect(plain.ok && 'agent' in plain.payload).toBe(false)
  })

  it('refuses an agent name that is not text', () => {
    for (const agent of [3, null, ['Claude']]) {
      const token = signed({ ...who, agent, expiresAt: Date.now() + 1e6 })
      expect(verifySyncToken(secret, token, 'design-1')).toEqual({ ok: false, reason: 'token with an agent not text' })
    }
  })

  it('refuses tokens that are not tokens', () => {
    for (const token of ['', 'abc', 'a.b.c', '.sig']) {
      expect(verifySyncToken(secret, token, 'design-1')).toEqual({
        ok: false,
        reason: expect.stringMatching(/malformed|bad signature/),
      })
    }
  })
})
