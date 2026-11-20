// `POST /oauth/token`: the authorization code swapped with its PKCE verifier, and refresh (RFC 6749 §4.1.3, §6),
// for public clients. The API checks the grant and answers the tokens or the OAuth error, never kept by a cache.
import { Hono } from 'hono'

import { askApi, type OAuthSettings, readForm, relay } from './relay.ts'

/** The token endpoint. */
export function tokenRoutes(settings: OAuthSettings): Hono {
  const app = new Hono()

  app.post('/oauth/token', async (c) => {
    const params = await readForm(c.req.raw)
    if (params instanceof Response) return params
    return relay(await askApi(settings, '/agent/tokens', params))
  })

  return app
}
