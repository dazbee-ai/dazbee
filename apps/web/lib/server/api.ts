// The API, called from the web app's server only, with every response read through its contract.
import 'server-only'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { cache } from 'react'
import { z } from 'zod'

import {
  ApiError,
  AssetInUse,
  AssetLink,
  AssetSummary,
  AssetUse,
  BrandSummary,
  DesignCover,
  DesignSummary,
  DesignThumbnail,
  FontFace,
  FontFamily,
  FontLink,
  type FontType,
  FontUploadTicket,
  type ImageType,
  InvitationToken,
  Me,
  type MemberRole,
  OpenedDesign,
  type SaveBrandKit,
  type SaveTemplate,
  type SaveVersion,
  SignedIn,
  SignedLink,
  SignedOut,
  SignInLink,
  type SignInRefusal,
  SignInRefused,
  StoredBrandKit,
  SyncToken,
  TemplateSummary,
  type UpdateAsset,
  type UpdateWorkspace,
  UploadTicket,
  VersionSummary,
  WorkspaceSummary,
} from '@dazbee/schema'

export class ApiFailure extends Error {
  readonly status: number
  /** The answer's body, for refusals that say more than their message. */
  readonly body: unknown
  constructor(status: number, message: string, body: unknown = null) {
    super(message)
    this.status = status
    this.body = body
  }
}

/** The httpOnly cookie that keeps the API's session token (#58). */
export const SESSION_COOKIE = 'dazbee_session'

const API_URL = process.env.API_URL ?? 'http://localhost:8787'

/**
 * WorkOS's sign-in page for this state, or null when sign-in is not set up (#58). It carries the token
 * of the invite the person came from, so WorkOS accepts it; a token no invite could have is left out. A site
 * with a /callback of its own, the early-access admin page's, gives it as `redirectUri`.
 */
export async function signInLink(state: string, invitationToken?: string, redirectUri?: string) {
  const query = new URLSearchParams({ state })
  const token = InvitationToken.safeParse(invitationToken)
  if (token.success) query.set('invitationToken', token.data)
  if (redirectUri) query.set('redirectUri', redirectUri)
  try {
    return (await call(SignInLink, `/auth/sign-in-url?${query}`, undefined, { signIn: false })).url
  } catch (e) {
    if (e instanceof ApiFailure && e.status === 404) return null
    throw e
  }
}

/**
 * Swaps the code WorkOS sent back for a session (#58), or, when early access refuses the person, the
 * reason it gave.
 */
export async function completeSignIn(code: string): Promise<SignedIn | { refused: SignInRefusal }> {
  try {
    return await call(SignedIn, '/auth/callback', { method: 'POST', body: { code } }, { signIn: false })
  } catch (e) {
    const refused = e instanceof ApiFailure && e.status === 403 ? SignInRefused.safeParse(e.body) : null
    if (refused?.success) return { refused: refused.data.reason }
    throw e
  }
}

/** Where to end the person's WorkOS session as they sign out, if anywhere (#58). */
export const signOutLink = async () =>
  (await call(SignedOut, '/auth/sign-out', { method: 'POST' }, { signIn: false })).logoutUrl

/**
 * The signed-in person, their workspaces and the one to open; null when nobody is signed in. A person early
 * access refused, as it does one whose access an admin removed, is sent to sign in with its notice.
 */
export async function findMe() {
  try {
    return await call(Me, '/me', undefined, { signIn: false })
  } catch (e) {
    if (!(e instanceof ApiFailure) || e.status !== 401) throw e
    const refused = SignInRefused.safeParse(e.body)
    if (refused.success) redirect(`/login?error=${refused.data.reason}`)
    return null
  }
}

/** The signed-in person, as `findMe` gives them, asked once per request; with no session, sign-in opens. */
export const getMe = cache(() => call(Me, '/me'))

/**
 * The person's role in the workspace and whether they are limited to some of its brands, from `getMe`. A
 * workspace not among theirs gives the fewest rights: a Reviewer's role, limited.
 */
export async function getAccess(workspaceId: string): Promise<{ role: MemberRole; limited: boolean }> {
  const id = workspaceId.toLowerCase()
  const theirs = (await getMe()).workspaces.find((workspace) => workspace.id === id)
  return theirs ? { role: theirs.role, limited: theirs.limited } : { role: 'reviewer', limited: true }
}

/** The person's role in the workspace, as `getAccess` gives it. */
export async function getRole(workspaceId: string): Promise<MemberRole> {
  return (await getAccess(workspaceId)).role
}

/**
 * The workspace, which marks it as the person's workspace used last; a 404 when they aren't its member.
 * Asked once per request, however many of the page's layouts and the page read it.
 */
export const getWorkspace = cache((workspaceId: string) => call(WorkspaceSummary, workspaceRoot(workspaceId)))

/** Renames the workspace. */
export const updateWorkspace = (workspaceId: string, patch: UpdateWorkspace) =>
  call(WorkspaceSummary, workspaceRoot(workspaceId), { method: 'PATCH', body: patch })

export const listBrands = (workspaceId: string) => call(BrandSummary.array(), `${workspaceRoot(workspaceId)}/brands`)

/** Adds a brand, with the website it was started from when there was one (#203). */
export const createBrand = (workspaceId: string, name: string, website?: string | null) =>
  call(BrandSummary, `${workspaceRoot(workspaceId)}/brands`, {
    method: 'POST',
    body: website ? { name, website } : { name },
  })

export const listDesigns = (workspaceId: string, brandId: string) =>
  call(DesignSummary.array(), `${brandRoot(workspaceId, brandId)}/designs`)

export const createDesign = (workspaceId: string, brandId: string, name: string, content?: unknown) =>
  call(DesignSummary, `${brandRoot(workspaceId, brandId)}/designs`, {
    method: 'POST',
    body: content === undefined ? { name } : { name, content },
  })

/** The brand and design, or null when the API has no such design for this session. */
export async function findDesign(workspaceId: string, brandId: string, designId: string) {
  try {
    const [design, brands] = await Promise.all([
      call(OpenedDesign, `${brandRoot(workspaceId, brandId)}/designs/${encodeURIComponent(designId)}`),
      listBrands(workspaceId),
    ])
    const brand = brands.find((c) => c.id === brandId)
    return brand ? { brand, design } : null
  } catch (e) {
    if (e instanceof ApiFailure && e.status === 404) return null
    throw e
  }
}

/** Renames a design (#159). */
export const renameDesign = (workspaceId: string, brandId: string, designId: string, name: string) =>
  call(DesignSummary, `${brandRoot(workspaceId, brandId)}/designs/${encodeURIComponent(designId)}`, {
    method: 'PATCH',
    body: { name },
  })

/** Copies a design as it is stored now, named after it with "copy" (#159). */
export const duplicateDesign = (workspaceId: string, brandId: string, designId: string) =>
  call(DesignSummary, `${brandRoot(workspaceId, brandId)}/designs/${encodeURIComponent(designId)}/duplicate`, {
    method: 'POST',
    body: {},
  })

/** Deletes a design for good (#159). */
export const deleteDesign = (workspaceId: string, brandId: string, designId: string) =>
  call(z.null(), `${brandRoot(workspaceId, brandId)}/designs/${encodeURIComponent(designId)}`, { method: 'DELETE' })

/** The size of a design's cover frame (#84), read without drawing, or null when it has nothing to show. */
export async function designCover(workspaceId: string, brandId: string, designId: string) {
  try {
    return await call(DesignCover, `${brandRoot(workspaceId, brandId)}/designs/${encodeURIComponent(designId)}/cover`)
  } catch (e) {
    if (e instanceof ApiFailure && e.status === 404) return null
    throw e
  }
}

/** A design's picture for the home (#84), or null when it has nothing to show yet. */
export async function designThumbnail(workspaceId: string, brandId: string, designId: string) {
  try {
    return await call(
      DesignThumbnail,
      `${brandRoot(workspaceId, brandId)}/designs/${encodeURIComponent(designId)}/thumbnail`,
    )
  } catch (e) {
    if (e instanceof ApiFailure && e.status === 404) return null
    throw e
  }
}

export const syncToken = (workspaceId: string, brandId: string, designId: string) =>
  call(SyncToken, `${brandRoot(workspaceId, brandId)}/designs/${encodeURIComponent(designId)}/sync-token`, {
    method: 'POST',
    body: {},
  })

/** A design's versions, newest first. */
export const listVersions = (workspaceId: string, brandId: string, designId: string) =>
  call(VersionSummary.array(), versionsPath(workspaceId, brandId, designId))

/** Saves the design as stored now as a named version; the API answers 409 when the history is full of named ones. */
export const saveVersion = (workspaceId: string, brandId: string, designId: string, input: SaveVersion) =>
  call(VersionSummary, versionsPath(workspaceId, brandId, designId), { method: 'POST', body: input })

/** Renames a version, which makes an automatic one named. */
export const renameVersion = (
  workspaceId: string,
  brandId: string,
  designId: string,
  versionId: string,
  name: string,
) => call(VersionSummary, versionsPath(workspaceId, brandId, designId, versionId), { method: 'PATCH', body: { name } })

/** Deletes a version, with its picture. */
export const deleteVersion = (workspaceId: string, brandId: string, designId: string, versionId: string) =>
  call(z.null(), versionsPath(workspaceId, brandId, designId, versionId), { method: 'DELETE' })

/** Makes a design of its own from a version, in the same brand, named `name` (Open as a copy). */
export const copyVersion = (workspaceId: string, brandId: string, designId: string, versionId: string, name: string) =>
  call(DesignSummary, `${versionsPath(workspaceId, brandId, designId, versionId)}/copy`, {
    method: 'POST',
    body: { name },
  })

/** A version's picture of its first frame as PNG bytes, drawn by the API the first time; null when it has none. */
export async function versionThumbnail(workspaceId: string, brandId: string, designId: string, versionId: string) {
  const response = await send(`${versionsPath(workspaceId, brandId, designId, versionId)}/thumbnail`)
  if (response.status === 404) return null
  if (!response.ok) throw new ApiFailure(response.status, `The API answered ${response.status}`)
  return response.body
}

/** The templates a brand can start from (#54): the workspace's and its own, newest first. */
export const listTemplates = (workspaceId: string, brandId: string) =>
  call(TemplateSummary.array(), `${brandRoot(workspaceId, brandId)}/templates`)

/** Saves a design as a template, for the whole workspace or the brand alone (#54). */
export const saveTemplate = (workspaceId: string, brandId: string, template: SaveTemplate) =>
  call(TemplateSummary, `${brandRoot(workspaceId, brandId)}/templates`, { method: 'POST', body: template })

/** Renames a template (#159). */
export const renameTemplate = (workspaceId: string, brandId: string, templateId: string, name: string) =>
  call(TemplateSummary, `${brandRoot(workspaceId, brandId)}/templates/${encodeURIComponent(templateId)}`, {
    method: 'PATCH',
    body: { name },
  })

/** Deletes a template for good (#159). */
export const deleteTemplate = (workspaceId: string, brandId: string, templateId: string) =>
  call(z.null(), `${brandRoot(workspaceId, brandId)}/templates/${encodeURIComponent(templateId)}`, {
    method: 'DELETE',
  })

/** A signed URL to a template's thumbnail, or null when this brand can't see the template (#54). */
export async function templateThumbnailLink(workspaceId: string, brandId: string, templateId: string) {
  try {
    return await call(
      SignedLink,
      `${brandRoot(workspaceId, brandId)}/templates/${encodeURIComponent(templateId)}/thumbnail`,
    )
  } catch (e) {
    if (e instanceof ApiFailure && e.status === 404) return null
    throw e
  }
}

/** Starts a design of the brand from a template: its own copy, with fresh ids (#54). */
export const startFromTemplate = (workspaceId: string, brandId: string, templateId: string, name?: string) =>
  call(DesignSummary, `${brandRoot(workspaceId, brandId)}/templates/${encodeURIComponent(templateId)}/designs`, {
    method: 'POST',
    body: name ? { name } : {},
  })

/** The brand's assets, newest first; with a query, those whose name or tags match every word of it (#52). */
export const listAssets = (workspaceId: string, brandId: string, query = '') =>
  call(
    AssetSummary.array(),
    `${brandRoot(workspaceId, brandId)}/assets${query.trim() ? `?q=${encodeURIComponent(query.trim())}` : ''}`,
  )

/** Uploads an image for the brand under a name: asks, PUTs the bytes to storage when asked to, records it (#52). */
export async function uploadAsset(
  workspaceId: string,
  brandId: string,
  bytes: Uint8Array<ArrayBuffer>,
  contentType: ImageType,
  name: string,
) {
  const brand = `${brandRoot(workspaceId, brandId)}/assets`
  const sha256 = Buffer.from(await crypto.subtle.digest('SHA-256', bytes)).toString('hex')
  const ticket = await call(UploadTicket, `${brand}/uploads`, {
    method: 'POST',
    body: { sha256, byteSize: bytes.length, contentType, name },
  })
  if (ticket.asset) return ticket.asset
  const put = await fetch(ticket.upload.url, { method: 'PUT', body: bytes, headers: ticket.upload.headers })
  if (!put.ok) throw new ApiFailure(502, `Storage answered ${put.status} to the upload`)
  return call(AssetSummary, brand, { method: 'POST', body: { sha256, name } })
}

/** An asset and a signed URL to its original, or null when the API has no such asset for this session. */
export async function assetLink(workspaceId: string, brandId: string, assetId: string) {
  try {
    return await call(AssetLink, `${brandRoot(workspaceId, brandId)}/assets/${encodeURIComponent(assetId)}`)
  } catch (e) {
    if (e instanceof ApiFailure && e.status === 404) return null
    throw e
  }
}

/** A signed URL to the asset's thumbnail, or null when the API has no such asset for this session (#52). */
export async function thumbnailLink(workspaceId: string, brandId: string, assetId: string) {
  try {
    return await call(SignedLink, `${brandRoot(workspaceId, brandId)}/assets/${encodeURIComponent(assetId)}/thumbnail`)
  } catch (e) {
    if (e instanceof ApiFailure && e.status === 404) return null
    throw e
  }
}

/** Renames an asset or sets its tags (#52). */
export const updateAsset = (workspaceId: string, brandId: string, assetId: string, update: UpdateAsset) =>
  call(AssetSummary, `${brandRoot(workspaceId, brandId)}/assets/${encodeURIComponent(assetId)}`, {
    method: 'PATCH',
    body: update,
  })

/** What of the brand shows its asset. */
export const assetUses = (workspaceId: string, brandId: string, assetId: string) =>
  call(AssetUse.array(), `${brandRoot(workspaceId, brandId)}/assets/${encodeURIComponent(assetId)}/uses`)

/** Deletes the brand's asset: null once it is gone, or what still uses it when the API refuses. */
export async function deleteAsset(workspaceId: string, brandId: string, assetId: string): Promise<AssetInUse | null> {
  try {
    return await call(z.null(), `${brandRoot(workspaceId, brandId)}/assets/${encodeURIComponent(assetId)}`, {
      method: 'DELETE',
    })
  } catch (e) {
    if (e instanceof ApiFailure && e.status === 409 && e.body) {
      const used = AssetInUse.safeParse(e.body)
      if (used.success) return used.data
    }
    throw e
  }
}

/** The fonts a brand picks from (#50): Google Fonts copied into our storage and the brand's uploads. */
export const listFonts = (workspaceId: string, brandId: string) =>
  call(FontFamily.array(), `${brandRoot(workspaceId, brandId)}/fonts`)

/** Uploads a font file for the brand: asks, PUTs the bytes to storage when asked to, records it. */
export async function uploadFont(
  workspaceId: string,
  brandId: string,
  bytes: Uint8Array<ArrayBuffer>,
  contentType: FontType,
) {
  const brand = `${brandRoot(workspaceId, brandId)}/fonts`
  const sha256 = Buffer.from(await crypto.subtle.digest('SHA-256', bytes)).toString('hex')
  const ticket = await call(FontUploadTicket, `${brand}/uploads`, {
    method: 'POST',
    body: { sha256, byteSize: bytes.length, contentType },
  })
  if (ticket.face) return ticket.face
  const put = await fetch(ticket.upload.url, { method: 'PUT', body: bytes, headers: ticket.upload.headers })
  if (!put.ok) throw new ApiFailure(502, `Storage answered ${put.status} to the upload`)
  return call(FontFace, brand, { method: 'POST', body: { sha256 } })
}

/** A face and signed URLs to its file and preview, or null when the API has no such face for this session. */
export async function fontLink(workspaceId: string, brandId: string, faceId: string) {
  try {
    return await call(FontLink, `${brandRoot(workspaceId, brandId)}/fonts/faces/${encodeURIComponent(faceId)}`)
  } catch (e) {
    if (e instanceof ApiFailure && e.status === 404) return null
    throw e
  }
}

/**
 * The brand's kit (#53): its colours, fonts and text styles designs bind to, its logo, its tone of
 * voice and when it was saved; null when the kit the API gives can't be read.
 */
export async function getBrandKit(workspaceId: string, brandId: string): Promise<StoredBrandKit | null> {
  const kit = StoredBrandKit.safeParse(await call(z.unknown(), `${brandRoot(workspaceId, brandId)}/kit`))
  return kit.success ? kit.data : null
}

/**
 * Saves the brand's whole kit (#53); a kit that leaves its text styles out keeps the ones it has. A
 * save made from a kit saved since is refused with 409.
 */
export const saveBrandKit = (workspaceId: string, brandId: string, kit: SaveBrandKit) =>
  call(StoredBrandKit, `${brandRoot(workspaceId, brandId)}/kit`, { method: 'PUT', body: kit })

/** A request to the API: its method, its body sent as JSON, and headers of its own. */
type CallInit = { method: string; body?: unknown; headers?: Record<string, string> }

/**
 * Calls the API as the signed-in person. Without a session the API answers 401, and the person is
 * sent to sign in, with the early-access notice when early access refused them; routes that must answer
 * instead pass `signIn: false`.
 */
export async function call<T extends z.ZodType>(
  schema: T,
  path: string,
  init?: CallInit,
  { signIn = true } = {},
): Promise<z.infer<T>> {
  const response = await send(path, init, { signIn })
  const json: unknown = response.status === 204 ? null : await response.json()
  if (!response.ok)
    throw new ApiFailure(
      response.status,
      ApiError.safeParse(json).data?.error ?? `The API answered ${response.status}`,
      json,
    )
  return schema.parse(json)
}

/** The API's path of a workspace. Ids are lower case, so a workspace typed in upper case is the same one. */
export function workspaceRoot(workspaceId: string) {
  return `/workspaces/${encodeURIComponent(workspaceId.toLowerCase())}`
}

/** Sends a request to the API as the signed-in person, as `call` does, and gives the answer unread. */
async function send(path: string, init?: CallInit, { signIn = true } = {}) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  const headers: Record<string, string> = { ...init?.headers }
  if (token) headers.authorization = `Bearer ${token}`
  if (init?.body !== undefined) headers['content-type'] = 'application/json'
  const response = await fetch(`${API_URL}${path}`, {
    cache: 'no-store',
    headers,
    ...(init ? { method: init.method, ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }) } : {}),
  })
  if (response.status === 401 && signIn) redirect(await signInAgain(response))
  return response
}

/**
 * Where a person the API answered 401 signs in again: /login, with the early-access notice when early access
 * refused them, as it does a person whose access an admin removed.
 */
async function signInAgain(response: Response): Promise<string> {
  const refused = SignInRefused.safeParse(await response.json().catch(() => null))
  return refused.success ? `/login?error=${refused.data.reason}` : '/login'
}

/** The API's path of a brand of a workspace. */
function brandRoot(workspaceId: string, brandId: string) {
  return `${workspaceRoot(workspaceId)}/brands/${encodeURIComponent(brandId)}`
}

/** The path of a design's versions, or of one of them. */
function versionsPath(workspaceId: string, brandId: string, designId: string, versionId?: string) {
  const versions = `${brandRoot(workspaceId, brandId)}/designs/${encodeURIComponent(designId)}/versions`
  return versionId === undefined ? versions : `${versions}/${encodeURIComponent(versionId)}`
}
