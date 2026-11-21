// Calls to the API on the private network, each with the agent's own token, and their answers read with the
// schema's shapes. The API is the one checker of what the agent's access may reach (ADR-0019). A font file or an
// image is read from the signed storage link the API answers, which is sent no token.
import { z } from 'zod'

import {
  type AddAssetFromUrl,
  AgentMe,
  ApiError,
  AssetLink,
  AssetSummary,
  BrandKit,
  BrandSummary,
  DesignSummary,
  FontFamily,
  FontLink,
  FROM_URL_TIMEOUT_MS,
  MAX_UPLOAD_BYTES,
  SyncToken,
} from '@dazbee/schema'

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
  /** The asset of the picture at an https link, which the API fetches and adds to the brand's library. */
  addAssetFromUrl(brandId: string, input: AddAssetFromUrl): Promise<AssetSummary>
  /** A sync token for the design's agent tab, which the design shows as `agent`. */
  syncToken(brandId: string, designId: string, agent: string): Promise<SyncToken>
  brandKit(brandId: string): Promise<BrandKit>
  /** The brand's font catalog: its families and their faces. */
  fonts(brandId: string): Promise<FontFamily[]>
  /** A face's font file. */
  fontBytes(brandId: string, faceId: string): Promise<Uint8Array>
  /** An image asset's stored bytes. */
  assetBytes(brandId: string, assetId: string): Promise<Uint8Array>
  /** An asset's record, with what reads its stored bytes from its signed link. */
  asset(brandId: string, assetId: string): Promise<StoredAsset>
}

/** An asset as the API gives it: its record, and its stored bytes, read only when asked. */
export interface StoredAsset {
  summary: AssetSummary
  bytes(): Promise<Uint8Array>
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
 * How long adding a picture from a link may take: the API's time to fetch it, then 30 seconds for its checks and
 * decode, within the endpoint's `CALL_TIMEOUT_MS`.
 */
const FROM_URL_CALL_MS = FROM_URL_TIMEOUT_MS + 30_000

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
  const brands = `/workspaces/${encodeURIComponent(workspaceId)}/brands`
  const brandPath = (brandId: string) => `${brands}/${encodeURIComponent(brandId)}`
  const ask = async <T>(
    method: string,
    path: string,
    shape: z.ZodType<T>,
    body?: unknown,
    timeoutMs = API_TIMEOUT_MS,
  ): Promise<T> => {
    try {
      return await call(settings, token, method, path, shape, body, timeoutMs)
    } catch (error) {
      if (error instanceof TokenRefused) onRefused()
      throw error
    }
  }

  const asset = async (brandId: string, assetId: string): Promise<StoredAsset> => {
    const link = await ask('GET', `${brandPath(brandId)}/assets/${encodeURIComponent(assetId)}`, AssetLink)
    return { summary: link.asset, bytes: () => linkedBytes(settings, link.url) }
  }

  return {
    brands: () => ask('GET', brands, BrandSummary.array()),
    designs: (brandId) => ask('GET', `${brandPath(brandId)}/designs`, DesignSummary.array()),
    assets: (brandId, query = '') =>
      ask('GET', `${brandPath(brandId)}/assets?${new URLSearchParams({ q: query })}`, AssetSummary.array()),
    createDesign: (brandId, name) => ask('POST', `${brandPath(brandId)}/designs`, DesignSummary, { name }),
    addAssetFromUrl: (brandId, input) =>
      ask('POST', `${brandPath(brandId)}/assets/from-url`, AssetSummary, input, FROM_URL_CALL_MS),
    syncToken: (brandId, designId, agent) =>
      ask('POST', `${brandPath(brandId)}/designs/${encodeURIComponent(designId)}/sync-token`, SyncToken, { agent }),
    brandKit: (brandId) => ask('GET', `${brandPath(brandId)}/kit`, BrandKit),
    fonts: (brandId) => ask('GET', `${brandPath(brandId)}/fonts`, FontFamily.array()),
    fontBytes: async (brandId, faceId) => {
      const link = await ask('GET', `${brandPath(brandId)}/fonts/faces/${encodeURIComponent(faceId)}`, FontLink)
      return linkedBytes(settings, link.url)
    },
    assetBytes: async (brandId, assetId) => (await asset(brandId, assetId)).bytes(),
    asset,
  }
}

/**
 * One call to the API, its answer read with `shape`, failing past `timeoutMs`; it throws `TokenRefused` on a 401
 * and `ApiRefusal` on any other error.
 */
async function call<T>(
  settings: ApiSettings,
  token: string,
  method: string,
  path: string,
  shape: z.ZodType<T>,
  body?: unknown,
  timeoutMs = API_TIMEOUT_MS,
): Promise<T> {
  const request = new Request(`${settings.url}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(timeoutMs),
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

/**
 * The bytes at a signed storage link, fetched with no token, at most `MAX_UPLOAD_BYTES` (the largest file Dazbee
 * stores); it throws `ApiRefusal` when they can't be read or are more.
 */
async function linkedBytes(settings: ApiSettings, url: string): Promise<Uint8Array> {
  const tooBig = () => new ApiRefusal(502, 'A file in Dazbee’s storage is larger than any it stores')
  let response: Response
  try {
    response = await (settings.fetch ?? fetch)(new Request(url, { signal: AbortSignal.timeout(API_TIMEOUT_MS) }))
  } catch {
    throw new ApiRefusal(503, 'Dazbee’s storage could not be reached; try again in a moment')
  }
  if (!response.ok) throw new ApiRefusal(502, `Dazbee’s storage answered ${response.status}`)
  if (Number(response.headers.get('content-length') ?? 0) > MAX_UPLOAD_BYTES) throw tooBig()
  const chunks: Uint8Array[] = []
  let size = 0
  for await (const chunk of response.body ?? []) {
    size += chunk.byteLength
    // Leaving the loop cancels the rest of the body.
    if (size > MAX_UPLOAD_BYTES) throw tooBig()
    chunks.push(chunk)
  }
  const bytes = new Uint8Array(size)
  let at = 0
  for (const chunk of chunks) {
    bytes.set(chunk, at)
    at += chunk.byteLength
  }
  return bytes
}
