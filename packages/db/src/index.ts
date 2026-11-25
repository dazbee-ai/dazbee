// The database every server shares: tables, migrations and a design as the sync server stores it.
import { fileURLToPath } from 'node:url'

import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import pg from 'pg'

import * as aiTables from './ai-tables.ts'
import * as tables from './tables.ts'

export * from './ai-tables.ts'
export * from './ids.ts'
export * from './journal.ts'
export * from './tables.ts'
export * from './versions.ts'

/** Every table, as the query builder knows them. */
const schema = { ...tables, ...aiTables }

export type Db = NodePgDatabase<typeof schema> & { $client: pg.Pool }

export interface Database {
  db: Db
  close(): Promise<void>
}

/** The migrations every database is brought up to, oldest first. */
export const MIGRATIONS = fileURLToPath(new URL('../migrations', import.meta.url))

/** The Postgres advisory lock a server holds while it migrates, so two servers never migrate at once. */
const MIGRATION_LOCK = 4_120_917_351

export function openDatabase(url: string, { max = 4 } = {}): Database {
  const pool = new pg.Pool({ connectionString: url, max })
  return { db: drizzle(pool, { schema }), close: () => pool.end() }
}

/**
 * Brings the database up to the latest migration; servers call it on start. It migrates on one
 * connection of the pool holding the migration lock, so a server that starts while another migrates
 * waits for it, then finds the migrations applied. The connection is closed afterwards, which frees
 * the lock whatever happened.
 */
export async function migrateDatabase(db: Db): Promise<void> {
  const client = await db.$client.connect()
  try {
    await client.query('select pg_advisory_lock($1)', [MIGRATION_LOCK])
    await migrate(drizzle(client), { migrationsFolder: MIGRATIONS })
  } finally {
    client.release(true)
  }
}
