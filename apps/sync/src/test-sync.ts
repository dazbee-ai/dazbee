// What every sync server test shares: Postgres from Docker Compose (like the API's seam tests), the
// key tokens are signed with, the member tokens are for, and waiting.
import { randomUUID } from 'node:crypto'

import { openDatabase } from '@dazbee/db'
import { type MemberRole, SCHEMA_VERSION } from '@dazbee/schema'
import { signSyncToken, SYNC_TOKEN_TTL_MS } from '@dazbee/sync-token'

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://dazbee:dazbee-local@127.0.0.1:55432/dazbee'
export const { db, close: closeDatabase } = openDatabase(DATABASE_URL)
export const secret = 'sync-test-secret-'.padEnd(32, 'x')
export const run = randomUUID().slice(0, 8)
export const who = { workspaceId: `workspace-${run}`, userId: 'user-1' }

/**
 * A token for `designId` as `who`'s member, or `userId`, with `role` (Editor unless given), for a
 * design at `schemaVersion` (the current one unless given), expiring `ttl` ms from now (one token
 * lifetime unless given), for an agent's tab when given an `agent` name.
 */
export function tokenFor(
  designId: string,
  {
    role = 'editor',
    ttl = SYNC_TOKEN_TTL_MS,
    schemaVersion = SCHEMA_VERSION,
    userId = who.userId,
    name = userId,
    agent,
  }: { role?: MemberRole; ttl?: number; schemaVersion?: number; userId?: string; name?: string; agent?: string } = {},
) {
  return signSyncToken(
    secret,
    { designId, ...who, userId, role, schemaVersion, name, ...(agent === undefined ? {} : { agent }) },
    Date.now() - SYNC_TOKEN_TTL_MS + ttl,
  ).token
}

/** Waits until `ok` holds, checking every 50 ms for up to `ms`; resolves to whether it held. */
export async function until(ok: () => boolean | Promise<boolean>, ms = 5000) {
  for (let waited = 0; waited < ms; waited += 50) {
    if (await ok()) return true
    await new Promise((r) => setTimeout(r, 50))
  }
  return ok()
}

/** Waits `ms`. */
export const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))
