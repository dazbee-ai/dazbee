// Sign-in's cookies: the session token from the API, the state that ties a WorkOS callback to the sign-in this
// browser started, the token of the invite that sign-in started from, so a sign-in that fails is tried again with
// it, and the page it comes back to. All are httpOnly, so no script can read them. Starting a sign-in sets the
// last three. Each sign-in the web app refuses or starts again is written to the server's stdout.
import 'server-only'

import { randomBytes } from 'node:crypto'

import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

import { InvitationToken } from '@dazbee/schema'

import { isPilotHost } from '@/lib/pilot-host.ts'

import { SESSION_COOKIE, signInLink, signOutLink } from './api.ts'

export { SESSION_COOKIE } from './api.ts'

/** The site a sign-in starts on: its origin, and its Host header, which says whether it is the pilot host. */
export interface SignInSite {
  origin: string | null
  host: string | null
}

/** What a sign-in carries through WorkOS and back: the token of the invite it started from, and the page to come back to. */
export interface SignInCarried {
  invitationToken?: unknown
  next?: unknown
}

export const STATE_COOKIE = 'dazbee_sign_in_state'
export const INVITATION_COOKIE = 'dazbee_sign_in_invitation'
export const NEXT_COOKIE = 'dazbee_sign_in_next'

/** How long a started sign-in may take to come back, and its invite's token and page to come back to are kept. */
export const STATE_SECONDS = 10 * 60

/** How the state of a sign-in that /callback started again begins; no other state does. */
export const AGAIN_STATE = 'again_'

/** The one page a sign-in comes back to, rather than opening a workspace: Connect an agent. */
export const COMES_BACK_TO = '/agents/connect'

/** Cookie settings for an origin: Secure whenever the site is served over https. */
export const cookieOptions = (origin: string | null | undefined) => ({
  httpOnly: true,
  sameSite: 'lax' as const,
  path: '/',
  secure: origin?.startsWith('https:') ?? false,
})

/**
 * A 303 to `to`: a path on this site, which stays relative so the browser keeps the address it used
 * (behind a proxy the server's own address is not the site's), or another site's address.
 */
export const seeOther = (to: string) => new NextResponse(null, { status: 303, headers: { location: to } })

/** The longest page to come back to that is kept; a sign-in request's id is 43 characters. */
const MAX_NEXT = 512

/** The origin a page to come back to is read against: no site on the web has it. */
const NO_SITE = 'http://next.invalid'

/**
 * Starts a sign-in in this browser: WorkOS's sign-in link, carrying the invite's token when it is one an
 * invite could have, with the state, that token and the page to come back to (`pageAfterSignIn`) kept in
 * short-lived cookies for WorkOS's answer at /callback. On the pilot host, WorkOS answers at that host's own
 * /callback. `again` marks a sign-in that /callback starts again. Null when sign-in is not set up.
 */
export async function startSignIn(carried: SignInCarried, site: SignInSite, again = false): Promise<string | null> {
  // Hex, so no fresh state begins like one started again.
  const state = `${again ? AGAIN_STATE : ''}${randomBytes(24).toString('hex')}`
  const token = InvitationToken.safeParse(carried.invitationToken)
  const next = pageAfterSignIn(carried.next)
  const pilotCallback = site.origin && isPilotHost(site.host) ? new URL('/callback', site.origin).href : undefined
  const url = await signInLink(state, token.data, pilotCallback)
  if (!url) return null
  const jar = await cookies()
  const options = { ...cookieOptions(site.origin), maxAge: STATE_SECONDS }
  jar.set(STATE_COOKIE, state, options)
  if (token.success) jar.set(INVITATION_COOKIE, token.data, options)
  else jar.delete(INVITATION_COOKIE)
  if (next) jar.set(NEXT_COOKIE, next, options)
  else jar.delete(NEXT_COOKIE)
  return url
}

/**
 * The page a sign-in comes back to, as a path on this site with its query, when `next` is the Connect an
 * agent page's; null for any other page and for any address off this site, so a sign-in never opens one.
 */
export function pageAfterSignIn(next: unknown): string | null {
  if (typeof next !== 'string' || next.length > MAX_NEXT || !next.startsWith(COMES_BACK_TO)) return null
  let url: URL
  try {
    url = new URL(next, NO_SITE)
  } catch {
    return null
  }
  if (url.origin !== NO_SITE || url.pathname !== COMES_BACK_TO) return null
  return `${url.pathname}${url.search}`
}

/** Sign-in's address for a person who must sign in to answer an agent's sign-in request, coming back to it after. */
export function signInForRequest(request: string): string {
  return `/login?${new URLSearchParams({ next: `${COMES_BACK_TO}?${new URLSearchParams({ request })}` })}`
}

/**
 * Writes what became of a sign-in the web app refused, couldn't finish or started again to the server's
 * stdout, as one JSON line with its reason. It never holds an email, a code or a token.
 */
export function logSignIn(outcome: string, fields: Record<string, string | number | null> = {}) {
  console.log(JSON.stringify({ event: 'sign-in', outcome, ...fields }))
}

/** Forgets the session token, ends the WorkOS session too when there was one, and sends the person to it or to sign in. */
export async function endSession() {
  return seeOther(await forgetSession())
}

/**
 * Forgets the session token and ends the WorkOS session too when there was one, from a route handler or
 * a server action; gives where the person goes next: WorkOS's sign-out, or sign in.
 */
export async function forgetSession(): Promise<string> {
  const jar = await cookies()
  const logoutUrl = jar.has(SESSION_COOKIE) ? await signOutLink().catch(() => null) : null
  jar.delete(SESSION_COOKIE)
  return logoutUrl ?? '/login'
}

/** Forgets the session token alone, for a person whose account is deleted: their WorkOS session went with it. */
export async function forgetDeletedSession() {
  const jar = await cookies()
  jar.delete(SESSION_COOKIE)
}
