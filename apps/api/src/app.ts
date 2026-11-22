// The API: every area's routes on one app. Each workspace is at /workspaces/:workspaceId, for its members
// only: a workspace the person is not a member of, a brand or design of another workspace, and a brand outside
// a limited member's, are answered as if they didn't exist (ADR-0016). Outside a workspace there are only
// /health, sign-in's /auth/* (with the development invites' accept route), the person's own /me and
// /me/*, early access's /admin/*, for admins only, its public request to join, /access-requests, the file
// sent to an agent's upload link, PUT /uploads/:token, whose token is its only key, and the Google faces' files
// and previews, GET /fonts/google/faces/:name, which anyone may read. A person
// whose account is deleted, or whose access an admin removed, is answered 401 on every route that needs a
// session. Every
// route below a brand reads its brand from `brandScope`, and an `Invalid*` error answers 400 here, and a
// `MemberRefusal` its own status, whichever route throws it. An agent's token (ADR-0019) reaches only
// /agent/me and the agents' routes of its access's workspace, and every other route answers it 403.
import { Hono } from 'hono'

import type { Db } from '@dazbee/db'
import { readSessionToken } from '@dazbee/session-token'
import type { Storage } from '@dazbee/storage'

import type { Admins } from './admin/admins.ts'
import { accessRequestRoutes, adminRoutes } from './admin/routes.ts'
import type { TurnstileCheck } from './admin/turnstile.ts'
import { type RequestLimit, requestLimit } from './admin/waiting-list.ts'
import { agentGate, agentRoutes } from './agents/agent-routes.ts'
import { agentConsentRoutes } from './agents/consent-routes.ts'
import { agentOAuthRoutes, type OAuthLimitSettings, oauthLimitSettings } from './agents/oauth-routes.ts'
import { agentAccessRoutes } from './agents/routes.ts'
import { InvalidUpload } from './assets/assets.ts'
import { AddingFromUrlBusy, FROM_URL_PER_HOUR } from './assets/from-url.ts'
import { assetRoutes, uploadRoutes } from './assets/routes.ts'
import { SvgBusy } from './assets/svg-assets.ts'
import { UploadLinkRefused } from './assets/upload-links.ts'
import { InvalidKit } from './brand-kits/brand-kits.ts'
import { ReadingWebsitesBusy, WEBSITES_PER_HOUR } from './brand-kits/from-website.ts'
import { brandKitRoutes } from './brand-kits/routes.ts'
import { FetchRefused, type SafeFetchSettings } from './fetch/safe-fetch.ts'
import { InvalidFont } from './fonts/fonts.ts'
import { fontRoutes, googleFontRoutes } from './fonts/routes.ts'
import { brandScope, type Env, error, membershipScope, requireSession } from './http.ts'
import { logError } from './log.ts'
import { meRoutes } from './me/routes.ts'
import { InvalidLimit } from './members/brand-limits.ts'
import { InvalidInvite, InviteConflict } from './members/invites.ts'
import type { InvitesProvider, InvitesProviders } from './members/invites-provider.ts'
import { MemberRefusal } from './members/members.ts'
import { memberRoutes } from './members/routes.ts'
import { devInviteRoutes, type DevInvitesSettings } from './sign-in/dev-invites.ts'
import { sessionRefusal } from './sign-in/early-access.ts'
import { signInRoutes } from './sign-in/routes.ts'
import { bearerToken, type SessionOf } from './sign-in/session.ts'
import type { SignInSettings } from './sign-in/sign-in.ts'
import { type StockLibrary, StockRefused } from './stock/pixabay.ts'
import { stockRoutes } from './stock/routes.ts'
import { templateRoutes } from './templates/routes.ts'
import { versionRoutes } from './versions/routes.ts'
import { InvalidContent } from './workspace/designs.ts'
import { brandRoutes, workspaceRoutes } from './workspace/routes.ts'

export function createApp({
  db,
  storage,
  sessionOf,
  syncSecret,
  build,
  signIn = null,
  invites = { workos: null, dev: null },
  admins = new Set(),
  requests = requestLimit(),
  turnstile = null,
  agentLimits = oauthLimitSettings({}),
  outsideFetch = {},
  fromUrlPerHour = FROM_URL_PER_HOUR,
  stock = null,
  websitesPerHour = WEBSITES_PER_HOUR,
}: {
  db: Db
  storage: Storage
  sessionOf: SessionOf
  syncSecret: string
  /** The commit this build is of, which /health names. */
  build: string
  signIn?: SignInSettings | null
  /** Who sends invites: WorkOS for a workspace with an organization, the development stand-in for one without. */
  invites?: { workos: InvitesProvider | null; dev: DevInvitesSettings | null }
  /** Early access's admins, who alone use /admin. */
  admins?: Admins
  /** The limit on requests to join from one address. */
  requests?: RequestLimit
  /** The Turnstile check on requests to join; none skips it. */
  turnstile?: TurnstileCheck | null
  /** The limits on agents' sign-ins and registrations, as the environment sets them; their defaults unless given. */
  agentLimits?: OAuthLimitSettings
  /** How the safe fetch reaches outside sites: the system's DNS and `node:https` unless given. */
  outsideFetch?: SafeFetchSettings
  /** The pictures from links a member may add in an hour, `FROM_URL_PER_HOUR` unless given. */
  fromUrlPerHour?: number
  /** The stock library photos are searched in and saved from; none turns stock search off. */
  stock?: StockLibrary | null
  /** The websites a member may read into kits in an hour, `WEBSITES_PER_HOUR` unless given. */
  websitesPerHour?: number
}) {
  const app = new Hono<Env>()

  app.use('*', agentGate(sessionOf))
  app.get('/health', (c) => c.json({ ok: true, build }))

  const providers: InvitesProviders = { workos: invites.workos, dev: invites.dev?.provider ?? null }
  app.route('/', signInRoutes({ db, signIn, invites: providers }))
  // The stand-in accepts Dazbee invites only when it sends them, which it does without WorkOS.
  app.route('/', devInviteRoutes({ db, dev: invites.dev && { ...invites.dev, dazbee: !invites.workos } }))
  app.route('/', adminRoutes({ db, sessionOf, admins, invites: providers }))
  app.route('/', accessRequestRoutes({ db, limit: requests, turnstile }))
  app.route('/', uploadRoutes({ db, storage, admins }))
  app.route('/', googleFontRoutes({ db, storage }))

  const signedIn = requireSession(sessionOf, sessionRefusal(db, admins))
  const records = new Hono<Env>()
    .route('/', brandRoutes({ db, storage, syncSecret }))
    .route('/', versionRoutes({ db, storage }))
    .route('/', assetRoutes({ db, storage, outsideFetch, fromUrlPerHour }))
    .route('/', templateRoutes({ db, storage }))
    .route('/', brandKitRoutes({ db, storage, outsideFetch, websitesPerHour }))
    .route('/', fontRoutes({ db, storage }))
    .route('/', stockRoutes({ db, storage, outsideFetch, stock, perHour: fromUrlPerHour }))

  app.use('/me', signedIn)
  app.use('/me/*', signedIn)
  const deleters = { storage, signIn: signIn?.provider ?? null, invites: invites.workos }
  app.route('/', meRoutes({ db, deleters, endWorkosSession: (request) => endWorkosSession(signIn, request) }))

  // Agents' sign-in answers the client without a session; the person's consent below needs theirs.
  app.route('/', agentOAuthRoutes({ db, limits: agentLimits }))
  app.use('/agent/*', signedIn)
  app.route('/', agentRoutes())

  // `/workspaces/:workspaceId/*` matches the workspace's own path too.
  app.use('/workspaces/:workspaceId/*', signedIn, membershipScope(db))
  app.use('/workspaces/:workspaceId/brands/:brandId/*', brandScope(db))
  app.route('/workspaces/:workspaceId', workspaceRoutes({ db }))
  app.route('/workspaces/:workspaceId', memberRoutes({ db, invites: providers }))
  app.route('/workspaces/:workspaceId', agentAccessRoutes({ db }))
  app.route('/', agentConsentRoutes({ db }))
  app.route('/workspaces/:workspaceId', records)

  // A refusal a route lets through answers 400 with its message; any other error is ours.
  app.onError((e, c) => {
    if (e instanceof MemberRefusal) return c.json(error(e.message), e.status)
    if (e instanceof StockRefused || e instanceof UploadLinkRefused) return c.json(error(e.message), e.status)
    if (e instanceof InviteConflict) return c.json(error(e.message), 409)
    if (e instanceof SvgBusy) return c.json(error(e.message), 503)
    if (e instanceof AddingFromUrlBusy || e instanceof ReadingWebsitesBusy) return c.json(error(e.message), 503)
    if (e instanceof InvalidContent) return c.json(error(`The design is not valid: ${e.message}`), 400)
    if (
      e instanceof InvalidUpload ||
      e instanceof FetchRefused ||
      e instanceof InvalidKit ||
      e instanceof InvalidFont ||
      e instanceof InvalidInvite ||
      e instanceof InvalidLimit
    )
      return c.json(error(e.message), 400)
    logError('unexpected-error', e, { method: c.req.method, route: c.req.routePath })
    return c.json(error('Something went wrong on our side'), 500)
  })

  return app
}

/** Ends the WorkOS session the request's session token came from, when sign-in is set up and it has one. */
async function endWorkosSession(signIn: SignInSettings | null, request: Request) {
  const token = bearerToken(request)
  const payload = signIn && token ? readSessionToken(signIn.secret, token) : null
  if (signIn && payload?.workosSessionId) await signIn.provider.endSession(payload.workosSessionId)
}
