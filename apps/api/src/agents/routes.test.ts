// Settings' routes of a member's agent accesses, against Postgres from Docker Compose
// (`docker compose up -d --wait postgres`).
import { describe, expect, it } from 'vitest'

import { AgentAccessSummary } from '@dazbee/schema'

import { addPerson, addWorkspace, db, request } from '../test-api.ts'
import { findAccessOfToken, issueTokens, makeAccess } from './agent-accesses.ts'

/** A workspace with two Editors, the first of whom gave Claude Code an access there. */
async function member() {
  const { id: workspaceId } = await addWorkspace()
  const editor = await addPerson([[workspaceId, 'editor']])
  const colleague = await addPerson([[workspaceId, 'editor']])
  const access = { userId: editor.id, workspaceId, brandIds: null, writes: true, clientId: null }
  const accessId = await makeAccess(db, { ...access, clientName: 'Claude Code' })
  return { workspaceId, editor, colleague, accessId, path: `/workspaces/${workspaceId}/agent-accesses` }
}

describe('agentAccessRoutes', () => {
  it("lists the member's own accesses that haven't ended", async () => {
    const m = await member()
    const listed = await request(m.editor.as, 'GET', m.path)
    expect(listed.status).toBe(200)
    expect(AgentAccessSummary.array().parse(listed.json)).toEqual([
      {
        id: m.accessId,
        clientName: 'Claude Code',
        brandIds: null,
        writes: true,
        createdAt: expect.any(String),
        lastUsedAt: null,
      },
    ])
    expect((await request(m.colleague.as, 'GET', m.path)).json).toEqual([])
  })

  it('ends the member’s own access, whose token then finds nothing, and no one else’s', async () => {
    const m = await member()
    const { accessToken } = await issueTokens(db, m.accessId)
    expect((await request(m.colleague.as, 'DELETE', `${m.path}/${m.accessId}`)).status).toBe(404)
    expect(await findAccessOfToken(db, accessToken)).not.toBeNull()
    expect((await request(m.editor.as, 'DELETE', `${m.path}/${m.accessId}`)).status).toBe(204)
    expect(await findAccessOfToken(db, accessToken)).toBeNull()
    expect((await request(m.editor.as, 'GET', m.path)).json).toEqual([])
    expect((await request(m.editor.as, 'DELETE', `${m.path}/${m.accessId}`)).status).toBe(404)
  })

  it('answers a workspace the person is not a member of as if it did not exist', async () => {
    const m = await member()
    const { id: elsewhere } = await addWorkspace()
    const outsider = await addPerson([[elsewhere, 'owner']])
    expect((await request(outsider.as, 'GET', m.path)).status).toBe(404)
    expect((await request(outsider.as, 'DELETE', `${m.path}/${m.accessId}`)).status).toBe(404)
  })
})
