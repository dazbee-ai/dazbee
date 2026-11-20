// What the OAuth endpoints share: reading a request's body or query as OAuth parameters, each name once, asking
// the API's sign-in routes on the private network, and giving its OAuth answer back. Nothing here logs a
// parameter, a code or a token.
import { getConnInfo } from '@hono/node-server/conninfo'
import { readRequestBody } from '@modelcontextprotocol/sdk/server/requestBody.js'
import type { Context } from 'hono'

import { AGENT_CLIENT_IP_HEADER, AGENT_RESOURCE_HEADER, OAuthError, type OAuthParams } from '@dazbee/schema'

import type { ApiSettings } from '../api.ts'
import { MAX_OAUTH_BODY_BYTES } from '../limits.ts'

/** What the OAuth endpoints need: the API, and the public base URL the server is reached at. */
export interface OAuthSettings {
  api: ApiSettings
  /** The public base URL, without a trailing slash. */
  baseUrl: string
}

/** What OAuth's answers carrying tokens or credentials never let a cache keep (RFC 6749 §5.1). */
export const NO_STORE = { 'cache-control': 'no-store', pragma: 'no-cache' }

/** How long a call to the API may take before the client is told to try again. */
const API_TIMEOUT_MS = 15_000

/** The parameters of a query or form, or null when a name comes more than once (RFC 6749 §3.1). */
export function paramsOf(search: URLSearchParams): OAuthParams | null {
  const params: OAuthParams = Object.create(null)
  for (const [name, value] of search) {
    if (Object.hasOwn(params, name)) return null
    params[name] = value
  }
  return params
}

/** The request's form parameters (RFC 6749 §3.2), or the OAuth error answer for a body that is not one form. */
export async function readForm(request: Request): Promise<OAuthParams | Response> {
  const text = await readText(request)
  if (text instanceof Response) return text
  const type = request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()
  const params = type === 'application/x-www-form-urlencoded' ? paramsOf(new URLSearchParams(text)) : null
  return params ?? oauthError(400, 'invalid_request', 'Send the parameters as a form, each once')
}

/** The request's JSON body, or the OAuth error answer `invalid` for a body that is not JSON. */
export async function readJson(request: Request, invalid: string): Promise<{ json: unknown } | Response> {
  const text = await readText(request, invalid)
  if (text instanceof Response) return text
  try {
    return { json: JSON.parse(text) as unknown }
  } catch {
    return oauthError(400, invalid, 'The body is not JSON')
  }
}

/**
 * POSTs `body` to the API's `path`, naming the resource this server serves and the client's address; the API's
 * answer, or null when it can't be reached.
 */
export async function askApi(
  { api, baseUrl }: OAuthSettings,
  path: string,
  body: unknown,
  clientAddress?: string,
): Promise<Response | null> {
  const request = new Request(`${api.url}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [AGENT_RESOURCE_HEADER]: `${baseUrl}/mcp`,
      ...(clientAddress === undefined ? {} : { [AGENT_CLIENT_IP_HEADER]: clientAddress }),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  })
  return (api.fetch ?? fetch)(request).catch(() => null)
}

/**
 * The API's OAuth answer given back to the client, kept from caches: its status and JSON when it is a success
 * or an OAuth error, else a `server_error`, or `temporarily_unavailable` when the API couldn't be reached.
 */
export async function relay(answer: Response | null): Promise<Response> {
  if (!answer) return oauthError(503, 'temporarily_unavailable', 'Dazbee can’t be reached; try again in a moment')
  const json: unknown = await answer.json().catch(() => undefined)
  const answered = answer.ok ? typeof json === 'object' && json !== null : OAuthError.safeParse(json).success
  if (!answered || answer.status >= 500) return oauthError(500, 'server_error', 'Dazbee failed to answer; try again')
  return Response.json(json, { status: answer.status, headers: NO_STORE })
}

/** An OAuth error answer (RFC 6749 §5.2), kept from caches. */
export function oauthError(status: number, error: string, description: string): Response {
  return Response.json({ error, error_description: description }, { status, headers: NO_STORE })
}

/** The client's address: Cloudflare's `CF-Connecting-IP`, else the socket's; empty when neither is known. */
export function clientAddress(c: Context): string {
  const forwarded = c.req.header('cf-connecting-ip')?.trim()
  if (forwarded) return forwarded
  try {
    return getConnInfo(c).remote.address ?? ''
  } catch {
    return ''
  }
}

/** The request's body as text, read up to `MAX_OAUTH_BODY_BYTES`, or the OAuth error answer for one too big or unreadable. */
async function readText(request: Request, invalid = 'invalid_request'): Promise<string | Response> {
  const read = await readRequestBody(request, MAX_OAUTH_BODY_BYTES).catch(() => null)
  if (read === null) return oauthError(400, invalid, 'The request body could not be read')
  if (read.tooLarge) return oauthError(413, invalid, 'The request is too large')
  return read.text
}
