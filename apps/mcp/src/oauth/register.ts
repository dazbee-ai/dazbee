// `POST /oauth/register`: dynamic client registration (RFC 7591), for public clients. The API checks the
// metadata and counts registrations by the client's address, which this passes on as Cloudflare saw it.
import { Hono } from 'hono'

import { askApi, clientAddress, type OAuthSettings, readJson, relay } from './relay.ts'

/** The registration endpoint. */
export function registerRoutes(settings: OAuthSettings): Hono {
  const app = new Hono()

  app.post('/oauth/register', async (c) => {
    const body = await readJson(c.req.raw, 'invalid_client_metadata')
    if (body instanceof Response) return body
    return relay(await askApi(settings, '/agent/clients', body.json, clientAddress(c)))
  })

  return app
}
