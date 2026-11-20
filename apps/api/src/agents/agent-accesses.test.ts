// Agent accesses and their tokens, against Postgres from Docker Compose (`docker compose up -d --wait postgres`).
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { agentTokens } from '@dazbee/db'

import { addPerson, addWorkspace, db } from '../test-api.ts'
import { endAccess, findAccessOfToken, issueTokens, listAccesses, makeAccess, refreshTokens } from './agent-accesses.ts'

const MINUTE = 60_000
const HOUR = 60 * MINUTE

/** A workspace of its own with an Editor and a second member, and an access the Editor gave Claude Code there. */
async function member() {
  const { id: workspaceId } = await addWorkspace()
  const editor = await addPerson([[workspaceId, 'editor']])
  const otherMember = await addPerson([[workspaceId, 'editor']])
  const access = { userId: editor.id, workspaceId, brandIds: null, writes: true, clientId: null }
  const accessId = await makeAccess(db, { ...access, clientName: 'Claude Code' })
  return { workspaceId, editor, otherMember, access, accessId }
}

describe('makeAccess', () => {
  it('makes an access that has no tokens until they are issued', async () => {
    const { accessId } = await member()
    expect(await db.select().from(agentTokens).where(eq(agentTokens.accessId, accessId))).toEqual([])
  })
})

describe('issueTokens', () => {
  it('gives an access token for an hour and a refresh token for 30 days, and keeps only their hashes', async () => {
    const { accessId } = await member()
    const now = new Date()
    const tokens = await issueTokens(db, accessId, now)
    expect(tokens.accessToken).toMatch(/^dazbee_at_[\w-]{43}$/)
    expect(tokens.refreshToken).toMatch(/^dazbee_rt_[\w-]{43}$/)
    expect(tokens.accessExpiresAt).toEqual(new Date(now.getTime() + HOUR))
    expect(tokens.refreshExpiresAt).toEqual(new Date(now.getTime() + 30 * 24 * HOUR))
    const rows = await db.select().from(agentTokens).where(eq(agentTokens.accessId, accessId))
    expect(rows.map((row) => row.kind).sort()).toEqual(['access', 'refresh'])
    const stored = JSON.stringify(rows)
    for (const token of [tokens.accessToken, tokens.refreshToken]) {
      expect(stored).not.toContain(token)
      expect(stored).not.toContain(token.slice('dazbee_at_'.length))
    }
  })
})

describe('findAccessOfToken', () => {
  it('finds the access of a live access token, never of a refresh token or a made-up one', async () => {
    const { accessId, editor, workspaceId } = await member()
    const tokens = await issueTokens(db, accessId)
    expect(await findAccessOfToken(db, tokens.accessToken)).toEqual({
      id: accessId,
      userId: editor.id,
      workspaceId,
      brandIds: null,
      writes: true,
      clientName: 'Claude Code',
    })
    expect(await findAccessOfToken(db, tokens.refreshToken)).toBeNull()
    expect(await findAccessOfToken(db, `dazbee_at_${'x'.repeat(43)}`)).toBeNull()
  })

  it('finds nothing once the token expires', async () => {
    const { accessId } = await member()
    const now = new Date()
    const { accessToken } = await issueTokens(db, accessId, now)
    expect(await findAccessOfToken(db, accessToken, new Date(now.getTime() + HOUR - 1))).not.toBeNull()
    expect(await findAccessOfToken(db, accessToken, new Date(now.getTime() + HOUR))).toBeNull()
  })

  it('writes when the access was last used at most once a minute', async () => {
    const { accessId, editor, workspaceId } = await member()
    const now = new Date()
    const { accessToken } = await issueTokens(db, accessId, now)
    const lastUsed = async () =>
      (await listAccesses(db, workspaceId, editor.id)).find((a) => a.id === accessId)?.lastUsedAt
    expect(await lastUsed()).toBeNull()
    await findAccessOfToken(db, accessToken, now)
    expect(await lastUsed()).toBe(now.toISOString())
    await findAccessOfToken(db, accessToken, new Date(now.getTime() + 59_000))
    expect(await lastUsed()).toBe(now.toISOString())
    const later = new Date(now.getTime() + MINUTE)
    await findAccessOfToken(db, accessToken, later)
    expect(await lastUsed()).toBe(later.toISOString())
  })
})

describe('refreshTokens', () => {
  it('gives a new pair, while the old access token keeps working until it expires', async () => {
    const { accessId } = await member()
    const now = new Date()
    const first = await issueTokens(db, accessId, now)
    const refreshed = await refreshTokens(db, first.refreshToken, new Date(now.getTime() + MINUTE))
    if (!refreshed.ok) throw new Error('the refresh was refused')
    expect(refreshed.tokens.accessToken).not.toBe(first.accessToken)
    expect(refreshed.tokens.refreshToken).not.toBe(first.refreshToken)
    expect(await findAccessOfToken(db, refreshed.tokens.accessToken, new Date(now.getTime() + MINUTE))).not.toBeNull()
    expect(await findAccessOfToken(db, first.accessToken, new Date(now.getTime() + 2 * MINUTE))).not.toBeNull()
    expect(await findAccessOfToken(db, first.accessToken, new Date(now.getTime() + HOUR))).toBeNull()
    const next = await refreshTokens(db, refreshed.tokens.refreshToken, new Date(now.getTime() + 2 * MINUTE))
    expect(next.ok).toBe(true)
  })

  it('answers invalid_grant to a refresh token used again within 30 seconds, and the access goes on', async () => {
    const { accessId } = await member()
    const now = new Date()
    const { refreshToken } = await issueTokens(db, accessId, now)
    const refreshed = await refreshTokens(db, refreshToken, now)
    if (!refreshed.ok) throw new Error('the refresh was refused')
    expect(await refreshTokens(db, refreshToken, new Date(now.getTime() + 30_000))).toEqual({
      ok: false,
      error: 'invalid_grant',
    })
    expect(await findAccessOfToken(db, refreshed.tokens.accessToken, now)).not.toBeNull()
    expect((await refreshTokens(db, refreshed.tokens.refreshToken, now)).ok).toBe(true)
  })

  it('ends the access when a refresh token is used again later', async () => {
    const { accessId } = await member()
    const now = new Date()
    const { refreshToken } = await issueTokens(db, accessId, now)
    const refreshed = await refreshTokens(db, refreshToken, now)
    if (!refreshed.ok) throw new Error('the refresh was refused')
    expect(await refreshTokens(db, refreshToken, new Date(now.getTime() + 30_001))).toEqual({
      ok: false,
      error: 'invalid_grant',
    })
    expect(await findAccessOfToken(db, refreshed.tokens.accessToken, now)).toBeNull()
    expect((await refreshTokens(db, refreshed.tokens.refreshToken, now)).ok).toBe(false)
  })

  it('deletes the access’s expired tokens as it refreshes, keeping the swapped refresh token that ends it if used again', async () => {
    const { accessId } = await member()
    const now = new Date()
    const first = await issueTokens(db, accessId, now)
    const later = new Date(now.getTime() + 2 * HOUR)
    const refreshed = await refreshTokens(db, first.refreshToken, later)
    if (!refreshed.ok) throw new Error('the refresh was refused')

    const rows = await db.select().from(agentTokens).where(eq(agentTokens.accessId, accessId))
    expect(rows.map((row) => [row.kind, row.swappedAt !== null]).sort()).toEqual([
      ['access', false],
      ['refresh', false],
      ['refresh', true],
    ])
    await refreshTokens(db, first.refreshToken, new Date(later.getTime() + MINUTE))
    expect(await findAccessOfToken(db, refreshed.tokens.accessToken, later)).toBeNull()
  })

  it('refuses an access token, a made-up or expired refresh token, and one of an ended access', async () => {
    const { accessId, access } = await member()
    const now = new Date()
    const tokens = await issueTokens(db, accessId, now)
    const refused = { ok: false, error: 'invalid_grant' }
    expect(await refreshTokens(db, tokens.accessToken, now)).toEqual(refused)
    expect(await refreshTokens(db, `dazbee_rt_${'x'.repeat(43)}`, now)).toEqual(refused)
    expect(await refreshTokens(db, tokens.refreshToken, new Date(now.getTime() + 30 * 24 * HOUR))).toEqual(refused)
    expect(await endAccess(db, access, accessId)).toBe(true)
    expect(await refreshTokens(db, tokens.refreshToken, now)).toEqual(refused)
  })
})

describe('endAccess', () => {
  it("ends the member's own access, whose tokens then find nothing; another member's it leaves be", async () => {
    const { accessId, access, otherMember, workspaceId } = await member()
    const { accessToken } = await issueTokens(db, accessId)
    expect(await endAccess(db, { workspaceId, userId: otherMember.id }, accessId)).toBe(false)
    expect(await findAccessOfToken(db, accessToken)).not.toBeNull()
    expect(await endAccess(db, access, accessId)).toBe(true)
    expect(await findAccessOfToken(db, accessToken)).toBeNull()
    expect(await endAccess(db, access, accessId)).toBe(false)
  })
})

describe('listAccesses', () => {
  it("lists only the member's own accesses in the workspace that haven't ended, newest first", async () => {
    const { accessId, access, otherMember, workspaceId, editor } = await member()
    const view = await makeAccess(db, { ...access, brandIds: [], writes: false, clientName: 'Claude Desktop' })
    const ended = await makeAccess(db, { ...access, clientName: 'Cursor' })
    await endAccess(db, access, ended)
    await makeAccess(db, { ...access, userId: otherMember.id, clientName: 'Theirs' })
    const { id: elsewhere } = await addWorkspace()
    await makeAccess(db, { ...access, workspaceId: elsewhere, clientName: 'Elsewhere' })
    const listed = await listAccesses(db, workspaceId, editor.id)
    expect(listed.map(({ id, clientName, brandIds, writes }) => ({ id, clientName, brandIds, writes }))).toEqual([
      { id: view, clientName: 'Claude Desktop', brandIds: [], writes: false },
      { id: accessId, clientName: 'Claude Code', brandIds: null, writes: true },
    ])
    expect(listed[0]?.createdAt).toMatch(/^\d{4}-\d\d-\d\dT/)
  })
})
