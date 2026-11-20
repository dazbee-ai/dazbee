// Who is asking. A signed-in person sends the session token the API gave them at sign-in (#58) as a
// bearer token; a development session can stand in locally and in CI, and every route of a workspace
// checks the person's membership there. An agent sends its access token (ADR-0019): its member, held to
// the access's workspace, brands and writing.
import { and, eq } from 'drizzle-orm'

import { brands, type Db, memberships, users, workspaces } from '@dazbee/db'
import { readSessionToken } from '@dazbee/session-token'

import { findAccessOfToken, isAgentToken } from '../agents/agent-accesses.ts'

/** The agent access a session of an agent's token is held to. */
export interface AgentSession {
  accessId: string
  workspaceId: string
  /** The brands the access names, or null for every brand the member sees. */
  brandIds: string[] | null
  writes: boolean
  clientName: string
}

/** Who is asking: a person, or an agent working for them when `agent` is given. */
export interface Session {
  userId: string
  agent?: AgentSession
}

/** Finds the session of a request, or null when it has none. */
export type SessionOf = (request: Request) => Session | null | Promise<Session | null>

export const DEV_WORKSPACE = { id: 'dev-workspace', name: 'Development agency' }
export const DEV_BRANDS = [
  { id: 'dev-brand-coffee', name: 'Harbour Coffee' },
  { id: 'dev-brand-cycles', name: 'Northline Cycles' },
]

/** The one development user, a person like any other, so what names them (a version they save) can. */
export const DEV_USER = { id: 'dev-user', workosUserId: 'dev-user', email: 'dev@localhost', name: 'Development user' }

/**
 * Every request is the one development user, whom the seed makes the development workspace's first Owner.
 * Never on in production.
 */
export const devSession: SessionOf = () => ({ userId: DEV_USER.id })

/**
 * Adds the development workspace, its brands and its user, unless they are there already, and makes the
 * user its Owner while the workspace has none: once Owner is handed over, the new Owner keeps it.
 */
export async function seedDevelopment(db: Db) {
  await db.insert(workspaces).values(DEV_WORKSPACE).onConflictDoNothing()
  await db
    .insert(brands)
    .values(DEV_BRANDS.map((c) => ({ ...c, workspaceId: DEV_WORKSPACE.id })))
    .onConflictDoNothing()
  await db.insert(users).values(DEV_USER).onConflictDoNothing()
  const [owner] = await db
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(and(eq(memberships.workspaceId, DEV_WORKSPACE.id), eq(memberships.role, 'owner')))
  if (owner) return
  await db
    .insert(memberships)
    .values({ workspaceId: DEV_WORKSPACE.id, userId: DEV_USER.id, role: 'owner' })
    .onConflictDoNothing({ target: [memberships.workspaceId, memberships.userId] })
}

/** The bearer token of a request, or null. */
export function bearerToken(request: Request): string | null {
  const header = request.headers.get('authorization')
  const match = header && /^Bearer ([\w.-]+)$/.exec(header)
  return match?.[1] ?? null
}

/**
 * The agent's token a request's bearer header holds, live or not, by its prefix in any case; null when it
 * holds none.
 */
export function agentToken(request: Request): string | null {
  const match = /^bearer\s+(\S+)/i.exec(request.headers.get('authorization')?.trim() ?? '')
  const token = match?.[1]
  return token && isAgentToken(token) ? token : null
}

/** Sessions from agents' access tokens, each held to its access, while it is live. */
export function agentSession(db: Db): SessionOf {
  return async (request) => {
    const token = agentToken(request)
    const access = token ? await findAccessOfToken(db, token) : null
    if (!access) return null
    const { id: accessId, userId, workspaceId, brandIds, writes, clientName } = access
    return { userId, agent: { accessId, workspaceId, brandIds, writes, clientName } }
  }
}

/** Sessions from bearer tokens; each route of a workspace then checks the person is a member there. */
export function tokenSession(secret: string): SessionOf {
  return (request) => {
    const token = bearerToken(request)
    const payload = token ? readSessionToken(secret, token) : null
    return payload ? { userId: payload.userId } : null
  }
}

/** The first of these that finds a session. */
export function firstSession(...ways: SessionOf[]): SessionOf {
  return async (request) => {
    for (const way of ways) {
      const session = await way(request)
      if (session) return session
    }
    return null
  }
}

/**
 * How the API finds who is asking. A request with an agent's token is that token's agent session or none, never
 * another way's. Otherwise a session token first, wherever there is a secret to read it with (WorkOS sign-in, or
 * the development session given SESSION_SECRET, so a check in the browser can sign in as a member in another
 * role), then the development session when it is on.
 */
export function sessionOfRequest({ db, secret, dev }: { db: Db; secret: string | null; dev: boolean }): SessionOf {
  const agent = agentSession(db)
  const person = firstSession(...(secret ? [tokenSession(secret)] : []), ...(dev ? [devSession] : []))
  return (request) => (agentToken(request) === null ? person(request) : agent(request))
}

/** The name a person gave at sign-in: empty for one who gave none, and for the development user. */
export async function userName(db: Db, userId: string): Promise<string> {
  const [user] = await db.select({ name: users.name }).from(users).where(eq(users.id, userId))
  return user?.name ?? ''
}
