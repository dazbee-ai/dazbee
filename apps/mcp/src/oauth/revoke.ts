// `POST /oauth/revoke`: token revocation (RFC 7009). Revoking a refresh token ends its agent access; revoking
// an access token stops it; an unknown token, or one of another client than `client_id`, is answered as revoked
// and changes nothing.
import { Hono } from 'hono'

import { askApi, type OAuthSettings, readForm, relay } from './relay.ts'

/** The revocation endpoint. */
export function revokeRoutes(settings: OAuthSettings): Hono {
  const app = new Hono()

  app.post('/oauth/revoke', async (c) => {
    const params = await readForm(c.req.raw)
    if (params instanceof Response) return params
    return relay(await askApi(settings, '/agent/tokens/revoke', params))
  })

  return app
}
