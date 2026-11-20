// An agent's sign-in through the API's OAuth routes, on the app built as main.ts builds it, against Postgres
// from Docker Compose: registration, the authorization request, the person's consent, the code swapped with
// its PKCE verifier, refresh and revoke.
import { randomInt } from 'node:crypto'

import { and, eq } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'

import { agentAccesses, agentAuthorizations, agentClients, agentTokens, memberships } from '@dazbee/db'

import { db } from '../test-api.ts'
import {
  address,
  asAgent,
  ask,
  asPerson,
  authorize,
  client,
  member,
  MINUTE,
  paramsOf,
  pkce,
  REDIRECT,
  register,
  RESOURCE,
  SECOND,
  signIn,
  start,
  token,
} from './test-oauth.ts'

describe('agentOAuthRoutes', () => {
  describe('an agent’s sign-in', () => {
    it('registers, is authorized by the member, swaps the code with its verifier, refreshes and is revoked', async () => {
      const { workspace, brandIds, person } = await member()
      const registered = await register({
        client_name: 'Claude Code',
        redirect_uris: [REDIRECT],
        token_endpoint_auth_method: 'none',
      })
      expect(registered).toMatchObject({
        status: 201,
        json: {
          client_name: 'Claude Code',
          redirect_uris: [REDIRECT],
          token_endpoint_auth_method: 'none',
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
        },
      })
      const clientId = registered.json.client_id as string
      const { verifier, challenge } = pkce()

      const started = await authorize(clientId, challenge)
      expect(started.status).toBe(201)
      const request = started.json.request as string

      const shown = await asPerson(person.as, 'GET', `/agent/authorizations/${request}`)
      expect(shown).toMatchObject({
        status: 200,
        json: {
          clientName: 'Claude Code',
          redirectHost: '127.0.0.1:43123',
          workspaces: [{ id: workspace.id, name: workspace.name, role: 'editor', limited: false }],
        },
      })

      const consent = await asPerson(person.as, 'POST', `/workspaces/${workspace.id}/agent-accesses`, {
        request,
        brandIds: [brandIds[0]],
        writes: true,
      })
      expect(consent.status).toBe(201)
      const redirect = new URL(String(consent.json.redirect))
      expect(`${redirect.origin}${redirect.pathname}`).toBe(REDIRECT)
      expect(paramsOf(redirect)).toEqual({ code: expect.any(String), state: 'state-1' })

      const swapped = await token({
        grant_type: 'authorization_code',
        code: paramsOf(redirect).code ?? '',
        redirect_uri: REDIRECT,
        code_verifier: verifier,
        client_id: clientId,
        resource: RESOURCE,
      })
      expect(swapped).toMatchObject({
        status: 200,
        json: {
          access_token: expect.stringMatching(/^dazbee_at_/),
          token_type: 'Bearer',
          expires_in: 3600,
          refresh_token: expect.stringMatching(/^dazbee_rt_/),
        },
      })
      expect(swapped.headers.get('cache-control')).toBe('no-store')
      const first = { access: swapped.json.access_token as string, refresh: swapped.json.refresh_token as string }

      expect(await asAgent(first.access, 'GET', '/agent/me')).toMatchObject({
        status: 200,
        json: { workspaceId: workspace.id, brandIds: [brandIds[0]], writes: true, clientName: 'Claude Code' },
      })

      const refresh = (refreshToken: string) =>
        token({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId, resource: RESOURCE })
      const refreshed = await refresh(first.refresh)
      expect(refreshed.status).toBe(200)
      expect(refreshed.headers.get('cache-control')).toBe('no-store')
      const second = { access: refreshed.json.access_token as string, refresh: refreshed.json.refresh_token as string }
      expect((await asAgent(second.access, 'GET', '/agent/me')).status).toBe(200)

      vi.setSystemTime(Date.now() + 10 * SECOND)
      expect(await refresh(first.refresh)).toMatchObject({ status: 400, json: { error: 'invalid_grant' } })
      expect((await asAgent(second.access, 'GET', '/agent/me')).status).toBe(200)

      vi.setSystemTime(Date.now() + 30 * SECOND)
      expect(await refresh(first.refresh)).toMatchObject({ status: 400, json: { error: 'invalid_grant' } })
      expect((await asAgent(second.access, 'GET', '/agent/me')).status).toBe(401)
      expect(await refresh(second.refresh)).toMatchObject({ status: 400, json: { error: 'invalid_grant' } })

      const again = await signIn({ workspace, brandIds, person })
      expect((await asAgent(again.accessToken, 'GET', '/agent/me')).status).toBe(200)
      const revoke = (clientId: string) =>
        ask('POST', '/agent/tokens/revoke', { token: again.refreshToken, client_id: clientId })
      expect((await revoke(clientId)).status).toBe(200)
      expect((await asAgent(again.accessToken, 'GET', '/agent/me')).status).toBe(200)
      const revoked = await revoke(again.clientId)
      expect(revoked.status).toBe(200)
      expect((await asAgent(again.accessToken, 'GET', '/agent/me')).status).toBe(401)
      const afterRevoke = await token({
        grant_type: 'refresh_token',
        refresh_token: again.refreshToken,
        client_id: again.clientId,
      })
      expect(afterRevoke).toMatchObject({ status: 400, json: { error: 'invalid_grant' } })
    })
  })

  describe('registration', () => {
    it('takes https:// and http:// on this machine, and refuses any other http://, a fragment and none or 11 URIs', async () => {
      const ok = ['https://example.com/cb?x=1', 'http://localhost/cb', 'http://127.0.0.1:9/cb', 'http://[::1]:5/cb']
      expect((await register({ redirect_uris: ok })).status).toBe(201)
      for (const redirect_uris of [
        ['http://example.com/cb'],
        ['http://127.0.0.2/cb'],
        ['https://example.com/cb#here'],
        ['https://user:pass@example.com/cb'],
        ['myapp://cb'],
        ['not an address'],
        [],
        Array.from({ length: 11 }, (_, i) => `https://example.com/${i}`),
      ])
        expect(await register({ redirect_uris })).toMatchObject({
          status: 400,
          json: { error: 'invalid_redirect_uri' },
        })
      expect(await register({})).toMatchObject({ status: 400, json: { error: 'invalid_redirect_uri' } })
      expect(await register({ redirect_uris: ok, client_name: 7 })).toMatchObject({
        status: 400,
        json: { error: 'invalid_client_metadata' },
      })
    })

    it('takes control characters out of the name, cuts it to 100 characters, and names a client with none "AI agent"', async () => {
      const named = async (client_name?: string) =>
        (await register({ redirect_uris: [REDIRECT], ...(client_name === undefined ? {} : { client_name }) })).json
          .client_name
      expect(await named(' Claude\u0007 ‮Code ')).toBe('Claude Code')
      expect(await named('é'.repeat(150))).toBe('é'.repeat(100))
      expect(await named()).toBe('AI agent')
      expect(await named('\u0000\t ')).toBe('AI agent')
    })

    it('registers every client as public, whatever it asks for', async () => {
      const registered = await register({
        redirect_uris: [REDIRECT],
        token_endpoint_auth_method: 'client_secret_post',
        grant_types: ['client_credentials'],
      })
      expect(registered.status).toBe(201)
      expect(registered.json).toMatchObject({
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
      })
      expect(registered.json).not.toHaveProperty('client_secret')
    })

    it('refuses the 21st registration within an hour from one address, and not another address’s', async () => {
      const from = address()
      for (let i = 0; i < 20; i++) expect((await register({ redirect_uris: [REDIRECT] }, from)).status).toBe(201)
      expect(await register({ redirect_uris: [REDIRECT] }, from)).toMatchObject({ status: 429 })
      expect((await register({ redirect_uris: [REDIRECT] })).status).toBe(201)
      vi.setSystemTime(Date.now() + 61 * MINUTE)
      expect((await register({ redirect_uris: [REDIRECT] }, from)).status).toBe(201)
    })

    it('counts an IPv6 address by its /64, which one client holds whole', async () => {
      const group = () => randomInt(0xffff).toString(16)
      const [prefix, other] = [`2001:db8:${group()}:${group()}`, `2001:db8:${group()}:${group()}`]
      for (let i = 0; i < 20; i++)
        expect((await register({ redirect_uris: [REDIRECT] }, `${prefix}::${i.toString(16)}`)).status).toBe(201)
      expect(await register({ redirect_uris: [REDIRECT] }, `${prefix}:0:0:0:ffff`)).toMatchObject({ status: 429 })
      expect((await register({ redirect_uris: [REDIRECT] }, `${other}::1`)).status).toBe(201)
    })
  })

  describe('authorize', () => {
    /** The usual request's parameters without those named. */
    function without(clientId: string, challenge: string, ...names: string[]) {
      const usual = {
        response_type: 'code',
        client_id: clientId,
        redirect_uri: REDIRECT,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state: 'state-1',
      }
      const kept = Object.entries(usual).filter(([name]) => !names.includes(name))
      return start(Object.fromEntries(kept))
    }

    it('refuses an unknown client and an unregistered redirect URI without a redirect', async () => {
      const clientId = await client()
      const { challenge } = pkce()
      for (const params of [
        { client_id: 'nobody' },
        { redirect_uri: 'http://127.0.0.1:43123/elsewhere' },
        { redirect_uri: `${REDIRECT}/` },
      ]) {
        const refused = await authorize(clientId, challenge, params)
        expect(refused.status).toBe(400)
        expect(refused.json).not.toHaveProperty('redirect')
      }
      const none = await without(clientId, challenge, 'redirect_uri')
      expect(none.status).toBe(400)
      expect(none.json).not.toHaveProperty('redirect')
    })

    it('sends a plain or missing challenge, a wrong resource and another response type back with the OAuth error', async () => {
      const clientId = await client()
      const { verifier, challenge } = pkce()
      const cases: [Record<string, string>, string][] = [
        [{ code_challenge_method: 'plain', code_challenge: verifier }, 'invalid_request'],
        [{ code_challenge: '' }, 'invalid_request'],
        [{ resource: 'https://elsewhere.test/mcp' }, 'invalid_target'],
        [{ response_type: 'token' }, 'unsupported_response_type'],
      ]
      for (const [params, error] of cases) {
        const refused = await authorize(clientId, challenge, params)
        expect(refused).toMatchObject({ status: 400, json: { error } })
        expect(paramsOf(refused.json.redirect)).toMatchObject({ error, state: 'state-1' })
        expect(String(refused.json.redirect).startsWith(`${REDIRECT}?`)).toBe(true)
      }
      expect(await without(clientId, challenge, 'code_challenge_method')).toMatchObject({
        status: 400,
        json: { error: 'invalid_request' },
      })
    })

    it('takes a request without a resource', async () => {
      const { challenge } = pkce()
      expect((await without(await client(), challenge)).status).toBe(201)
    })

    it('sends a refusal back only to a client on this machine, never to an https:// address', async () => {
      const elsewhere = 'https://agent.example/callback'
      const registered = await register({ redirect_uris: [elsewhere] })
      const clientId = registered.json.client_id as string
      const refused = await authorize(clientId, pkce().challenge, { redirect_uri: elsewhere, response_type: 'token' })
      expect(refused).toMatchObject({ status: 400, json: { error: 'unsupported_response_type' } })
      expect(refused.json).not.toHaveProperty('redirect')
      expect((await authorize(clientId, pkce().challenge, { redirect_uri: elsewhere })).status).toBe(201)
    })

    it('takes a registered loopback redirect URI at another port, and nothing else at another port', async () => {
      const clientId = await client()
      const { verifier, challenge } = pkce()
      const moved = 'http://127.0.0.1:50000/callback'
      expect((await authorize(clientId, challenge, { redirect_uri: 'http://127.0.0.1:50000/elsewhere' })).status).toBe(
        400,
      )
      expect((await authorize(clientId, challenge, { redirect_uri: 'http://localhost:43123/callback' })).status).toBe(
        400,
      )
      const started = await authorize(clientId, challenge, { redirect_uri: moved })
      expect(started.status).toBe(201)
      const { workspace, person } = await member()
      const consent = await asPerson(person.as, 'POST', `/workspaces/${workspace.id}/agent-accesses`, {
        request: started.json.request,
        brandIds: null,
        writes: false,
      })
      expect(String(consent.json.redirect).startsWith(`${moved}?`)).toBe(true)
      const swap = { grant_type: 'authorization_code', code: paramsOf(consent.json.redirect).code ?? '' }
      const rest = { code_verifier: verifier, client_id: clientId }
      expect((await token({ ...swap, ...rest, redirect_uri: REDIRECT })).status).toBe(400)
      expect((await token({ ...swap, ...rest, redirect_uri: moved })).status).toBe(200)
    })

    it('refuses the 61st sign-in within an hour from one address', async () => {
      const clientId = await client()
      const { challenge } = pkce()
      const usual = {
        response_type: 'code',
        client_id: clientId,
        redirect_uri: REDIRECT,
        code_challenge: challenge,
        code_challenge_method: 'S256',
      }
      const from = address()
      for (let i = 0; i < 60; i++) expect((await start(usual, from)).status).toBe(201)
      expect(await start(usual, from)).toMatchObject({ status: 429 })
      expect((await start(usual)).status).toBe(201)
    })
  })

  describe('the code', () => {
    /** A code the member allowed, with what swapping it takes. */
    async function allowed() {
      const { workspace, person } = await member()
      const clientId = await client()
      const { verifier, challenge } = pkce()
      const request = (await authorize(clientId, challenge)).json.request as string
      const consent = await asPerson(person.as, 'POST', `/workspaces/${workspace.id}/agent-accesses`, {
        request,
        brandIds: null,
        writes: true,
      })
      const params = {
        grant_type: 'authorization_code',
        code: paramsOf(consent.json.redirect).code ?? '',
        redirect_uri: REDIRECT,
        code_verifier: verifier,
        client_id: clientId,
      }
      return { workspace, person, params }
    }

    it('works once, and used again ends the access it gave', async () => {
      const { params } = await allowed()
      const first = await token(params)
      expect(first.status).toBe(200)
      const me = async () => (await asAgent(first.json.access_token as string, 'GET', '/agent/me')).status
      expect((await token({ ...params, code_verifier: pkce().verifier })).status).toBe(400)
      expect(await me()).toBe(200)
      expect(await token(params)).toMatchObject({ status: 400, json: { error: 'invalid_grant' } })
      expect(await me()).toBe(401)
    })

    it('works only with its redirect URI, its client and the right verifier', async () => {
      const { params } = await allowed()
      const other = await client()
      for (const wrong of [
        { redirect_uri: `${REDIRECT}/other` },
        { client_id: other },
        { code_verifier: pkce().verifier },
        { code_verifier: 'short' },
        { code: `${params.code}x` },
        { resource: 'https://elsewhere.test/mcp' },
      ])
        expect((await token({ ...params, ...wrong })).status).toBe(400)
      expect(await token({ ...params, client_id: 'nobody' })).toMatchObject({
        status: 401,
        json: { error: 'invalid_client' },
      })
      expect((await token(params)).status).toBe(200)
    })

    it('does not work after 60 seconds', async () => {
      const { params } = await allowed()
      vi.setSystemTime(Date.now() + 61 * SECOND)
      expect(await token(params)).toMatchObject({ status: 400, json: { error: 'invalid_grant' } })
    })

    it('does not work once its person has left the workspace', async () => {
      const { workspace, person, params } = await allowed()
      await db
        .delete(memberships)
        .where(and(eq(memberships.workspaceId, workspace.id), eq(memberships.userId, person.id)))
      expect(await token(params)).toMatchObject({ status: 400, json: { error: 'invalid_grant' } })
    })

    it('answers an unknown grant type and a refresh for another client with the OAuth error', async () => {
      const { params } = await allowed()
      const tokens = await token(params)
      expect(await token({ grant_type: 'password' })).toMatchObject({
        status: 400,
        json: { error: 'unsupported_grant_type' },
      })
      const refresh = { grant_type: 'refresh_token', refresh_token: tokens.json.refresh_token as string }
      expect(await token({ ...refresh, client_id: await client() })).toMatchObject({
        status: 400,
        json: { error: 'invalid_grant' },
      })
      expect((await token({ ...refresh, client_id: params.client_id })).status).toBe(200)
    })
  })

  describe('what is kept and logged', () => {
    it('keeps no token, code or request id, and logs none', async () => {
      const logged = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
        vi.spyOn(console, method).mockImplementation(() => {}),
      )
      const { workspace, brandIds, person } = await member()
      const signed = await signIn({ workspace, brandIds, person })
      const refreshed = await token({
        grant_type: 'refresh_token',
        refresh_token: signed.refreshToken,
        client_id: signed.clientId,
      })
      const denied = (await authorize(signed.clientId, pkce().challenge)).json.request as string
      expect((await asPerson(person.as, 'GET', `/agent/authorizations/${denied}`)).status).toBe(200)
      expect((await asPerson(person.as, 'POST', `/agent/authorizations/${denied}/deny`)).status).toBe(200)
      const secrets = [
        denied,
        signed.request,
        signed.code,
        signed.accessToken,
        signed.refreshToken,
        refreshed.json.access_token as string,
        refreshed.json.refresh_token as string,
      ]
      const kept = JSON.stringify(
        await Promise.all([
          db.select().from(agentAuthorizations),
          db.select().from(agentTokens),
          db.select().from(agentAccesses),
          db.select().from(agentClients),
        ]),
      )
      const lines = JSON.stringify(logged.map((spy) => spy.mock.calls))
      for (const spy of logged) spy.mockRestore()
      for (const secret of secrets) {
        expect(secret.length).toBeGreaterThan(20)
        expect(kept).not.toContain(secret)
        expect(lines).not.toContain(secret)
      }
    })
  })
})
