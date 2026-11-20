// Sync tokens: the API signs one for one design after its workspace and brand checks, and the sync
// server accepts a connection only with a valid, unexpired token for the design it opens.
// A token is base64url(JSON payload) "." base64url(HMAC-SHA256 of that text), keyed by a secret
// both servers read from SYNC_TOKEN_SECRET. It carries the member's role, which decides whether the
// connection may write, the design's schema version, below which a tab may not open it, and the
// member's name, which the other tabs show, and for an agent's tab the agent's name; an open
// connection sends a fresh token before its token expires.
import { createHmac, timingSafeEqual } from 'node:crypto'

import { MemberRole } from '@dazbee/schema'

export interface SyncTokenPayload {
  designId: string
  workspaceId: string
  userId: string
  role: MemberRole
  /** The schema version the design is at, which the API keeps on its record: a tab built before it may not open it. */
  schemaVersion: number
  /** The member's name, which the other tabs show ("Ann is editing"): empty when they gave none. */
  name: string
  /** For an agent's tab (ADR-0019), the agent's name, which the other tabs show for it; absent for a person's tab. */
  agent?: string
  /** Expiry, in milliseconds since the epoch. */
  expiresAt: number
}

/** The most characters of a member's name a token carries: a longer one is cut. */
export const SYNC_NAME_CHARS = 200

/** The most characters of an agent's name a token carries: a longer one is cut. */
export const SYNC_AGENT_CHARS = 64

/** How long a token is good for, at connect and on an open connection. */
export const SYNC_TOKEN_TTL_MS = 10 * 60 * 1000

/** The shared secret from the environment; refuses one too short to be a real key. */
export function syncTokenSecret(env: NodeJS.ProcessEnv = process.env): string {
  const secret = env.SYNC_TOKEN_SECRET
  if (!secret || secret.length < 32) throw new Error('SYNC_TOKEN_SECRET must be set to at least 32 characters')
  return secret
}

export function signSyncToken(
  secret: string,
  payload: Omit<SyncTokenPayload, 'expiresAt'>,
  now = Date.now(),
): { token: string; expiresAt: number } {
  const expiresAt = now + SYNC_TOKEN_TTL_MS
  const name = cut(payload.name, SYNC_NAME_CHARS)
  const agent = payload.agent === undefined ? {} : { agent: cut(payload.agent, SYNC_AGENT_CHARS) }
  const text = Buffer.from(JSON.stringify({ ...payload, name, ...agent, expiresAt })).toString('base64url')
  return { token: `${text}.${sign(secret, text)}`, expiresAt }
}

/**
 * The token's payload when it is signed with `secret`, unexpired and for `designId`; otherwise why not.
 * Its expiry is trusted no further than one token lifetime from `now`.
 */
export function verifySyncToken(
  secret: string,
  token: string,
  designId: string,
  now = Date.now(),
): { ok: true; payload: SyncTokenPayload } | { ok: false; reason: string } {
  const [text, signature, extra] = token.split('.')
  if (!text || !signature || extra !== undefined) return { ok: false, reason: 'malformed token' }
  const expected = Buffer.from(sign(secret, text))
  const given = Buffer.from(signature)
  if (expected.length !== given.length || !timingSafeEqual(expected, given))
    return { ok: false, reason: 'bad signature' }
  let payload: Omit<SyncTokenPayload, 'name' | 'agent'> & { name?: unknown; agent?: unknown }
  try {
    payload = JSON.parse(Buffer.from(text, 'base64url').toString('utf8')) as typeof payload
  } catch {
    return { ok: false, reason: 'malformed token' }
  }
  if (typeof payload.expiresAt !== 'number' || payload.expiresAt <= now) return { ok: false, reason: 'expired token' }
  if (payload.designId !== designId) return { ok: false, reason: 'token for another design' }
  if (!MemberRole.safeParse(payload.role).success) return { ok: false, reason: 'token without a role' }
  if (!Number.isSafeInteger(payload.schemaVersion) || payload.schemaVersion < 1)
    return { ok: false, reason: 'token without a schema version' }
  // A token signed before tokens carried names has none.
  const name = payload.name === undefined ? '' : payload.name
  if (typeof name !== 'string') return { ok: false, reason: 'token with a name not text' }
  // A person's tab's token has no agent.
  const { agent, ...rest } = payload
  if (agent !== undefined && typeof agent !== 'string') return { ok: false, reason: 'token with an agent not text' }
  return {
    ok: true,
    payload: {
      ...rest,
      name: cut(name, SYNC_NAME_CHARS),
      ...(agent === undefined ? {} : { agent: cut(agent, SYNC_AGENT_CHARS) }),
      expiresAt: Math.min(payload.expiresAt, now + SYNC_TOKEN_TTL_MS),
    },
  }
}

/** A name cut to `chars` characters, never inside one. */
function cut(name: string, chars: number): string {
  return [...name].slice(0, chars).join('')
}

function sign(secret: string, text: string) {
  return createHmac('sha256', secret).update(text).digest('base64url')
}
