// What the migration tests share: throwaway databases on the Postgres `DATABASE_URL` names, a folder holding the
// first migrations only, and applying a folder's migrations. Imported by tests only.
import { randomUUID } from 'node:crypto'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { migrate } from 'drizzle-orm/node-postgres/migrator'
import pg from 'pg'
import { afterAll } from 'vitest'

import { MIGRATIONS, openDatabase } from './index.ts'

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://dazbee:dazbee-local@127.0.0.1:55432/dazbee'

interface Journal {
  entries: { tag: string; when: number }[]
}

export const journal = JSON.parse(await readFile(join(MIGRATIONS, 'meta', '_journal.json'), 'utf8')) as Journal

/** Databases and folders the cases made, removed once they have run. */
const made: { databases: string[]; folders: string[] } = { databases: [], folders: [] }

afterAll(async () => {
  const admin = new pg.Client({ connectionString: DATABASE_URL })
  await admin.connect()
  try {
    for (const name of made.databases) await admin.query(`drop database if exists "${name}" with (force)`)
  } finally {
    await admin.end()
  }
  await Promise.all(made.folders.map((folder) => rm(folder, { recursive: true, force: true })))
})

/** Makes an empty database beside `DATABASE_URL`'s, dropped after the file runs; its URL. */
export async function freshDatabase(): Promise<string> {
  const name = `dazbee_migrations_${randomUUID().slice(0, 8)}`
  const admin = new pg.Client({ connectionString: DATABASE_URL })
  await admin.connect()
  try {
    await admin.query(`create database "${name}"`)
  } finally {
    await admin.end()
  }
  made.databases.push(name)
  const url = new URL(DATABASE_URL)
  url.pathname = `/${name}`
  return url.toString()
}

/** A copy of the migrations folder whose journal lists only its first `count` migrations. */
export async function firstMigrations(count: number): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), 'dazbee-migrations-'))
  made.folders.push(folder)
  await cp(MIGRATIONS, folder, { recursive: true })
  await writeFile(
    join(folder, 'meta', '_journal.json'),
    JSON.stringify({ ...journal, entries: journal.entries.slice(0, count) }),
  )
  return folder
}

/** Applies the migrations `folder`'s journal lists that `url`'s database hasn't run; how many it has run in all. */
export async function applyMigrations(url: string, folder: string): Promise<number> {
  const { db, close } = openDatabase(url, { max: 1 })
  try {
    await migrate(db, { migrationsFolder: folder })
  } finally {
    await close()
  }
  return withClient(url, async (client) => {
    const result = await client.query<{ count: string }>('select count(*) from drizzle.__drizzle_migrations')
    return Number(result.rows[0]?.count)
  })
}

/** Runs `use` with a client on `url`'s database. */
export async function withClient<T>(url: string, use: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: url })
  await client.connect()
  try {
    return await use(client)
  } finally {
    await client.end()
  }
}
