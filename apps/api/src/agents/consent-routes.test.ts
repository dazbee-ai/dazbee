// The person's answer to an agent's sign-in request through the API's consent routes, on the app built as
// main.ts builds it, against Postgres from Docker Compose: the request shown, the consent and the refusal.
import { describe, expect, it, vi } from 'vitest'

import { ask, asPerson, authorize, client, member, MINUTE, paramsOf, pkce, SECOND } from './test-oauth.ts'

describe('agentConsentRoutes', () => {
  describe('consent', () => {
    /** A request waiting for consent, with its verifier. */
    async function waiting() {
      const clientId = await client()
      const { verifier, challenge } = pkce()
      const started = await authorize(clientId, challenge)
      return { clientId, verifier, request: started.json.request as string }
    }

    const allow = (as: string, workspaceId: string, body: unknown) =>
      asPerson(as, 'POST', `/workspaces/${workspaceId}/agent-accesses`, body)

    it('refuses an expired, tampered or answered request', async () => {
      const { workspace, person } = await member()
      const choice = { brandIds: null, writes: true }
      const { request } = await waiting()
      expect((await allow(person.as, workspace.id, { request: `${request}x`, ...choice })).status).toBe(404)
      expect((await asPerson(person.as, 'GET', `/agent/authorizations/${request.slice(1)}`)).status).toBe(404)
      vi.setSystemTime(Date.now() + 10 * MINUTE + SECOND)
      expect((await asPerson(person.as, 'GET', `/agent/authorizations/${request}`)).status).toBe(404)
      expect((await allow(person.as, workspace.id, { request, ...choice })).status).toBe(404)

      vi.setSystemTime(new Date())
      const answered = await waiting()
      expect((await allow(person.as, workspace.id, { request: answered.request, ...choice })).status).toBe(201)
      expect((await allow(person.as, workspace.id, { request: answered.request, ...choice })).status).toBe(404)
    })

    it('refuses a brand the member can’t see, and writes for a Reviewer, leaving the request waiting', async () => {
      const limited = await member('editor', true)
      const { request } = await waiting()
      const other = await member()
      for (const brandIds of [[limited.brandIds[1] ?? ''], [other.brandIds[0] ?? ''], ['no-such-brand']])
        expect((await allow(limited.person.as, limited.workspace.id, { request, brandIds, writes: true })).status).toBe(
          404,
        )
      const first = [limited.brandIds[0]]
      expect(
        (await allow(limited.person.as, limited.workspace.id, { request, brandIds: first, writes: true })).status,
      ).toBe(201)

      const reviewer = await member('reviewer')
      const next = await waiting()
      const asked = { request: next.request, brandIds: null }
      expect((await allow(reviewer.person.as, reviewer.workspace.id, { ...asked, writes: true })).status).toBe(403)
      expect((await allow(reviewer.person.as, reviewer.workspace.id, { ...asked, writes: false })).status).toBe(201)
    })

    it('needs the person’s session, in a workspace of theirs', async () => {
      const { workspace } = await member()
      const { request } = await waiting()
      const choice = { request, brandIds: null, writes: true }
      expect((await ask('GET', `/agent/authorizations/${request}`)).status).toBe(401)
      expect((await ask('POST', `/workspaces/${workspace.id}/agent-accesses`, choice)).status).toBe(401)
      const stranger = await member()
      expect((await allow(stranger.person.as, workspace.id, choice)).status).toBe(404)
    })

    it('denies with access_denied and the state, and the request is gone', async () => {
      const { workspace, person } = await member()
      const { request } = await waiting()
      const denied = await asPerson(person.as, 'POST', `/agent/authorizations/${request}/deny`)
      expect(denied.status).toBe(200)
      expect(paramsOf(denied.json.redirect)).toMatchObject({ error: 'access_denied', state: 'state-1' })
      expect((await allow(person.as, workspace.id, { request, brandIds: null, writes: true })).status).toBe(404)
    })

    it('leaves no access in Settings until the code is swapped', async () => {
      const { workspace, person } = await member()
      const { request } = await waiting()
      expect((await allow(person.as, workspace.id, { request, brandIds: null, writes: true })).status).toBe(201)
      expect(await asPerson(person.as, 'GET', `/workspaces/${workspace.id}/agent-accesses`)).toMatchObject({
        status: 200,
        json: [],
      })
    })
  })
})
