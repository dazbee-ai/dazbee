// The documents an MCP client reads to learn how to sign in: the protected resource metadata (RFC 9728), which
// names `/mcp` and its authorization server, this same base URL, and that server's metadata (RFC 8414): its
// endpoints, and that it takes only the authorization code with PKCE S256, for public clients.
import { Hono } from 'hono'

/** The metadata documents, for the server reached at `baseUrl`. */
export function metadataRoutes({ baseUrl }: { baseUrl: string }): Hono {
  const app = new Hono()
  const resource = {
    resource: `${baseUrl}/mcp`,
    authorization_servers: [baseUrl],
    bearer_methods_supported: ['header'],
    resource_name: 'Dazbee',
  }
  const server = {
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}/oauth/authorize`,
    token_endpoint: `${baseUrl}/oauth/token`,
    registration_endpoint: `${baseUrl}/oauth/register`,
    revocation_endpoint: `${baseUrl}/oauth/revoke`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    revocation_endpoint_auth_methods_supported: ['none'],
  }

  app.get('/.well-known/oauth-protected-resource/mcp', (c) => c.json(resource))
  app.get('/.well-known/oauth-protected-resource', (c) => c.json(resource))
  app.get('/.well-known/oauth-authorization-server', (c) => c.json(server))

  return app
}
