// Dazbee's OAuth sign-in for agents as the MCP server serves it (ADR-0019): the metadata and the registration,
// authorization, token and revocation endpoints, each passed on to the API, which runs the sign-in.
import { Hono } from 'hono'

import { authorizeRoutes } from './authorize.ts'
import { metadataRoutes } from './metadata.ts'
import { registerRoutes } from './register.ts'
import type { OAuthSettings } from './relay.ts'
import { revokeRoutes } from './revoke.ts'
import { tokenRoutes } from './token.ts'

/** Every sign-in route. */
export function oauthRoutes(settings: OAuthSettings): Hono {
  return new Hono()
    .route('/', metadataRoutes(settings))
    .route('/', registerRoutes(settings))
    .route('/', authorizeRoutes(settings))
    .route('/', tokenRoutes(settings))
    .route('/', revokeRoutes(settings))
}
