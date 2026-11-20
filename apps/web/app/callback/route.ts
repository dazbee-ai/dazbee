// WorkOS sends the person back here after sign-in: check the state is the one this browser started with, swap the
// code for a session at the API, keep its token in an httpOnly cookie, and open the workspace sign-in chose, or the
// Connect an agent page the sign-in started from. A sign-in early access refuses goes back to sign in with its
// reason. A sign-in that started from an invite or from Connect an agent and fails goes back to sign in with the
// invite's token and the page, so trying again still accepts it and comes back. On the pilot host, sign-in opens
// the early-access admin page, that host's `/`.
// A sign-in this browser didn't start, such as the sign-up an invite email's link opens at WorkOS, which
// WorkOS then sends here with no state, is started again once from here, without its code: WorkOS answers
// at once for the person it just signed in. Each refused or restarted sign-in is logged with its reason.
import { cookies } from 'next/headers'
import type { NextRequest, NextResponse } from 'next/server'

import { workspacePath } from '@/lib/brand-routes.ts'
import { isPilotHost } from '@/lib/pilot-host.ts'
import { ApiFailure, completeSignIn } from '@/lib/server/api.ts'
import {
  AGAIN_STATE,
  cookieOptions,
  INVITATION_COOKIE,
  logSignIn,
  NEXT_COOKIE,
  pageAfterSignIn,
  seeOther,
  SESSION_COOKIE,
  type SignInCarried,
  type SignInSite,
  startSignIn,
  STATE_COOKIE,
} from '@/lib/server/sign-in.ts'

/** An error code as WorkOS names one; anything else in a callback's `error` is not logged. */
const WORKOS_ERROR = /^[a-z_]{1,64}$/

export async function GET(request: NextRequest) {
  const jar = await cookies()
  const code = request.nextUrl.searchParams.get('code')
  const state = request.nextUrl.searchParams.get('state')
  const expected = jar.get(STATE_COOKIE)?.value
  const invitationToken = jar.get(INVITATION_COOKIE)?.value
  const next = pageAfterSignIn(jar.get(NEXT_COOKIE)?.value)
  jar.delete(STATE_COOKIE)
  jar.delete(INVITATION_COOKIE)
  jar.delete(NEXT_COOKIE)
  const failed = (error = '1') => {
    const again = new URLSearchParams({
      error,
      ...(invitationToken ? { invitation_token: invitationToken } : {}),
      ...(next ? { next } : {}),
    })
    return seeOther(`/login?${again}`)
  }
  if (!code) {
    const workosError = request.nextUrl.searchParams.get('error')
    logSignIn('refused', {
      reason: 'no-code',
      workosError: workosError && WORKOS_ERROR.test(workosError) ? workosError : null,
    })
    return failed()
  }
  if (!state || state !== expected) return startAgain(request, state, expected, { invitationToken, next }, failed)
  let session
  try {
    session = await completeSignIn(code)
  } catch (e) {
    const answered = e instanceof ApiFailure
    logSignIn(answered && e.status < 500 ? 'refused' : 'unfinished', {
      reason: 'api-failed',
      ...(answered ? { status: e.status, error: e.message } : { error: String(e) }),
    })
    return failed()
  }
  if ('refused' in session) {
    logSignIn('refused', { reason: session.refused })
    return failed(session.refused)
  }
  jar.set(SESSION_COOKIE, session.token, {
    ...cookieOptions(request.nextUrl.origin),
    expires: new Date(session.expiresAt),
  })
  return seeOther(isPilotHost(request.headers.get('host')) ? '/' : (next ?? workspacePath(session.open)))
}

/**
 * Starts again a sign-in this browser didn't start, leaving its code unused, so no code from elsewhere signs
 * anyone in here, keeping the invite's token and the page to come back to. One started again that comes back
 * without its state, or with another, is refused, so it never loops: its state, or the state cookie it left, begins
 * like one started again.
 */
async function startAgain(
  request: NextRequest,
  state: string | null,
  expected: string | undefined,
  carried: SignInCarried,
  failed: () => NextResponse,
): Promise<NextResponse> {
  const why = !state ? 'no-state' : !expected ? 'not-started-here' : 'other-state'
  if (state?.startsWith(AGAIN_STATE) || expected?.startsWith(AGAIN_STATE)) {
    logSignIn('refused', { reason: `${why}-after-starting-again` })
    return failed()
  }
  let url
  try {
    url = await startSignIn(carried, site(request), true)
  } catch (e) {
    logSignIn('unfinished', { reason: 'start-again-failed', error: String(e) })
    return failed()
  }
  if (!url) {
    logSignIn('unfinished', { reason: 'sign-in-not-set-up' })
    return failed()
  }
  logSignIn('started-again', { reason: why })
  return seeOther(url)
}

/**
 * The site the request came to: the Host header's, as the browser addressed it, over the protocol Next read
 * from the proxy; behind a proxy, the request's own URL names the server, not the site.
 */
function site(request: NextRequest): SignInSite {
  const host = request.headers.get('host')
  return { origin: host ? `${request.nextUrl.protocol}//${host}` : request.nextUrl.origin, host }
}
