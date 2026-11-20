// Calls to the API on the private network, each with the agent's own token, and their answers read with the
// schema's shapes. The API is the one checker of what the agent's access may reach (ADR-0019).
import { z } from 'zod'

import { AgentMe, ApiError, AssetSummary, BrandSummary, DesignSummary } from '@dazbee/schema'

/** Where the API is, and the fetch that reaches it. */
export interface ApiSettings {
  /** The API's private address, without a trailing slash. */
  url: string
  fetch?: (request: Request) => Promise<Response>
}

/** What an agent's token may ask the API in its access's workspace. */
export interface AgentApi {
  brands(): Promise<BrandSummary[]>
  designs(brandId: string): Promise<DesignSummary[]>
  assets(brandId: string, query?: string): Promise<AssetSummary[]>
  createDesign(brandId: string, name: string): Promise<DesignSummary>
}

/** The API answered a call with an error: its status and the sentence it gave. */
export class ApiRefusal extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/** The API refused the agent's token (401), which the client refreshes. */
export class TokenRefused extends Error {
  constructor() {
    super('Dazbee refused this access token; sign in again')
  }
}

/** How long a call to the API may take before it counts as failed. */
const API_TIMEOUT_MS = 30_000

/**
 * The access `token` belongs to, or null when the API refuses it (a token that is not a live agent access
 * token). It throws when the API can't be reached or answers otherwise.
 */
export async function agentOf(settings: ApiSettings, token: string): Promise<AgentMe | null> {
  try {
    return await call(settings, token, 'GET', '/agent/me', AgentMe)
  } catch (error) {
    if (error instanceof TokenRefused || (error instanceof ApiRefusal && error.status === 403)) return null
    throw error
  }
}

/**
 * The API as `token`'s agent sees it in `workspaceId`. `onRefused` is called when the API refuses the token
 * on a call, before that call throws `TokenRefused`.
 */
export function agentApi(settings: ApiSettings, token: string, workspaceId: string, onRefused: () => void): AgentApi {
  const brandPath = (brandId: string) =>
    `/workspaces/${encodeURIComponent(workspaceId)}/brands/${encodeURIComponent(brandId)}`
  const ask = async <T>(method: string, path: string, shape: z.ZodType<T>, body?: unknown): Promise<T> => {
    try {
      return await call(settings, token, method, path, shape, body)
    } catch (error) {
      if (error instanceof TokenRefused) onRefused()
      throw error
    }
  }

  return {
    brands: () => ask('GET', `/workspaces/${encodeURIComponent(workspaceId)}/brands`, BrandSummary.array()),
    designs: (brandId) => ask('GET', `${brandPath(brandId)}/designs`, DesignSummary.array()),
    assets: (brandId, query = '') =>
      ask('GET', `${brandPath(brandId)}/assets?${new URLSearchParams({ q: query })}`, AssetSummary.array()),
    createDesign: (brandId, name) => ask('POST', `${brandPath(brandId)}/designs`, DesignSummary, { name }),
  }
}

/** One call to the API, its answer read with `shape`; it throws `TokenRefused` on a 401 and `ApiRefusal` on any other error. */
async function call<T>(
  settings: ApiSettings,
  token: string,
  method: string,
  path: string,
  shape: z.ZodType<T>,
  body?: unknown,
): Promise<T> {
  const request = new Request(`${settings.url}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  })
  let response: Response
  try {
    response = await (settings.fetch ?? fetch)(request)
  } catch {
    throw new ApiRefusal(503, 'Dazbee could not be reached; try again in a moment')
  }
  if (response.status === 401) throw new TokenRefused()
  const answer: unknown = await response.json().catch(() => undefined)
  if (!response.ok) {
    const error = ApiError.safeParse(answer)
    throw new ApiRefusal(response.status, error.success ? error.data.error : `Dazbee answered ${response.status}`)
  }
  const parsed = shape.safeParse(answer)
  if (!parsed.success) throw new ApiRefusal(502, 'Dazbee gave an answer this server could not read')
  return parsed.data
}
