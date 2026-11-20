// `GET /oauth/authorize`: an agent's authorization request (RFC 6749 §4.1.1 with PKCE). The API checks it and keeps
// it, and the person is sent to the web app's Connect an agent page to decide. A request for an unknown client or
// redirect URI, or with a parameter given twice, is answered with a page saying so, never a redirect, so no one
// can send the person to an address the client didn't register; any other problem is sent back to the client.
import { Hono } from 'hono'

import { AgentAuthorizationStarted } from '@dazbee/schema'

import { askApi, clientAddress, type OAuthSettings, paramsOf } from './relay.ts'

/** The headers of every answer here: kept from caches, and the address it came from kept from the next page. */
const PRIVATE = { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' }

/** The authorization endpoint. */
export function authorizeRoutes(settings: OAuthSettings): Hono {
  const app = new Hono()

  app.get('/oauth/authorize', async (c) => {
    const params = paramsOf(new URL(c.req.url).searchParams)
    if (!params) return errorPage(400, 'The sign-in link gives a parameter more than once.')
    const answer = await askApi(settings, '/agent/authorizations', params, clientAddress(c))
    const started = AgentAuthorizationStarted.safeParse(await answer?.json().catch(() => undefined))
    if (!answer || !started.success || answer.status >= 500)
      return errorPage(503, 'Dazbee can’t be reached; try again in a moment.')
    if ('request' in started.data) {
      const connect = new URL(`${settings.baseUrl}/agents/connect`)
      connect.searchParams.set('request', started.data.request)
      return redirect(connect.toString())
    }
    if (started.data.redirect) return redirect(started.data.redirect)
    return errorPage(answer.status, started.data.error_description ?? 'This sign-in link is not valid.')
  })

  return app
}

/** A page telling the person why the agent can't sign in, which runs nothing and loads nothing. */
function errorPage(status: number, message: string): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Dazbee</title></head><body><h1>The agent can’t sign in</h1><p>${escape(message)}</p><p>Connect the agent to Dazbee again from the agent.</p></body></html>`
  return new Response(html, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'content-security-policy': "default-src 'none'",
      ...PRIVATE,
    },
  })
}

/** 302 to `location`. */
function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { location, ...PRIVATE } })
}

/** `text` with HTML's special characters written as entities. */
function escape(text: string): string {
  return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`)
}
