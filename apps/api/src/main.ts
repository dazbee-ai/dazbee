// The API server: migrates the database, then serves. Settings come from the environment only, and a limit set out
// of its range stops it from starting (`oauthLimitSettings`).
import { serve } from '@hono/node-server'
import { PgBoss } from 'pg-boss'

import { ensureQueue, FLOW_QUEUE } from '@dazbee/ai'
import { migrateDatabase, openDatabase } from '@dazbee/db'
import { sessionSecret } from '@dazbee/session-token'
import { openStorage, storageSettings } from '@dazbee/storage'
import { syncTokenSecret } from '@dazbee/sync-token'

import { adminEmails } from './admin/admins.ts'
import { turnstileCheck } from './admin/turnstile.ts'
import { oauthLimitSettings } from './agents/oauth-routes.ts'
import { createApp } from './app.ts'
import { startSvgThread } from './assets/svg-assets.ts'
import { finishSoon } from './me/pending-deletions.ts'
import { workosInvites } from './members/invites-provider.ts'
import { devInvites } from './sign-in/dev-invites.ts'
import { allowList } from './sign-in/early-access.ts'
import { seedDevelopment, sessionOfRequest } from './sign-in/session.ts'
import { workosProvider, workosSettings } from './sign-in/sign-in.ts'
import { pixabayFromEnv } from './stock/pixabay.ts'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is not set')
const port = Number(process.env.API_PORT ?? 8787)
const syncSecret = syncTokenSecret()
const agentLimits = oauthLimitSettings(process.env)
const storage = openStorage(storageSettings())
// Local and CI storage starts empty; deployed buckets are made once, by hand.
if (process.env.STORAGE_CREATE_BUCKET === 'on') await storage.ensureBucket()
// Sign-in with WorkOS (#58) when its settings are given; the development session only when asked for.
const workos = workosSettings()
const dev = process.env.DAZBEE_DEV_SESSION === 'on'
if (dev && process.env.NODE_ENV === 'production') throw new Error('DAZBEE_DEV_SESSION is never on in production')
// While ALLOWED_EMAILS or ADMIN_EMAILS names any email, sign-up is in early access: only those it allows,
// and those an admin invites, get in.
const admins = adminEmails()
const allowed = allowList()
const signIn = workos ? { provider: workosProvider(workos), secret: sessionSecret(), allowed, admins } : null

const { db, close } = openDatabase(databaseUrl)
await migrateDatabase(db)
if (dev) await seedDevelopment(db)
// The API only sends AI jobs (ADR-0022): the worker runs them and keeps pg-boss's own upkeep.
const boss = new PgBoss({ connectionString: databaseUrl, max: 2, supervise: false, schedule: false })
boss.on('error', (e) => console.error(JSON.stringify({ msg: 'pg-boss error', error: String(e) })))
await boss.start()
await ensureQueue(boss, FLOW_QUEUE)

// The development session reads session tokens too when it has a secret, so a check in the browser can sign in as a Reviewer.
const tokenSecret = signIn?.secret ?? (dev && process.env.SESSION_SECRET ? sessionSecret() : null)
const sessionOf = sessionOfRequest({ db, secret: tokenSecret, dev })
// Invites go through WorkOS for a workspace with an organization. The development stand-in serves one
// without, such as the development workspace, when the development session is on and tokens can be
// signed; its links open the web app at WEB_URL, else on its local port.
const invites = {
  workos: workos ? workosInvites(workos) : null,
  dev:
    dev && tokenSecret
      ? { provider: devInvites(db, process.env.WEB_URL ?? 'http://localhost:3000'), secret: tokenSecret }
      : null,
}
// The image sets BUILD_ID to the commit it was built from; a server run from a checkout is `dev`.
const build = process.env.BUILD_ID || 'dev'
// Requests to join pass Cloudflare Turnstile's check when TURNSTILE_SECRET_KEY is set.
const turnstile = turnstileCheck()
// Agents' stock photo search is on when PIXABAY_API_KEY is set.
const stock = pixabayFromEnv(process.env)
const app = createApp({
  db,
  storage,
  sessionOf,
  syncSecret,
  build,
  signIn,
  invites,
  admins,
  turnstile,
  agentLimits,
  stock,
  boss,
})
// What deleted accounts left outside the database and couldn't delete then is tried again, beside serving.
finishSoon(db, { storage, signIn: signIn?.provider ?? null, invites: invites.workos })
const ways =
  [
    signIn && `WorkOS sign-in${signIn.allowed || admins.size > 0 ? ' in early access' : ''}`,
    dev && 'the development session',
  ]
    .filter(Boolean)
    .join(' and ') || 'no way to sign in'
const server = serve({ fetch: app.fetch, port }, () => console.log(`api on http://localhost:${port} with ${ways}`))
// The SVG thread loads CanvasKit beside serving, so the first SVG file seldom waits for it and /health never does.
void startSvgThread()

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => void boss.stop({ graceful: false }).finally(close)))
}
