// Every migration keeps the rows written under the ones before it. Each case makes its own
// throwaway database on the Postgres `DATABASE_URL` names (the compose one locally and in CI).
import { randomUUID } from 'node:crypto'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { migrate } from 'drizzle-orm/node-postgres/migrator'
import pg from 'pg'
import { afterAll, describe, expect, it } from 'vitest'

import { MIGRATIONS, openDatabase } from './index.ts'

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://dazbee:dazbee-local@127.0.0.1:55432/dazbee'

interface Journal {
  entries: { tag: string; when: number }[]
}

const journal = JSON.parse(await readFile(join(MIGRATIONS, 'meta', '_journal.json'), 'utf8')) as Journal

/** Databases and folders the cases made, removed once they have run. */
const made: { databases: string[]; folders: string[] } = { databases: [], folders: [] }

/**
 * The rows every case writes under one migration and reads back after the next: one of each kind
 * of record a person keeps, each found again by its first column.
 */
const ROWS = {
  users: { id: 'user-kept', workos_user_id: 'workos-kept', email: 'ann@example.com', name: 'Ann' },
  workspaces: { id: 'workspace-kept', name: 'Harbour' },
  memberships: { workspace_id: 'workspace-kept', user_id: 'user-kept', role: 'owner' },
  brands: { id: 'brand-kept', workspace_id: 'workspace-kept', name: 'Harbour Coffee' },
  designs: {
    id: 'design-kept',
    workspace_id: 'workspace-kept',
    brand_id: 'brand-kept',
    name: 'Spring sale',
    schema_version: 1,
  },
  design_saves: {
    design_id: 'design-kept',
    sync_id: 'sync-kept',
    entry: '3',
    seq: '2',
    last_entry: '3',
    state: Buffer.from('{"meta":{"name":"Spring sale"}}'),
    placed: { p1: { seq: 1, author: 1 } },
    tabs: {},
    next_tab_id: 1,
    versioned_seq: '0',
  },
} as const

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
async function freshDatabase(): Promise<string> {
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
async function firstMigrations(count: number): Promise<string> {
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
async function applyMigrations(url: string, folder: string): Promise<number> {
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
async function withClient<T>(url: string, use: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: url })
  await client.connect()
  try {
    return await use(client)
  } finally {
    await client.end()
  }
}

/** Writes `ROWS`, naming only their columns, so a table that has since gained columns takes them too. */
async function writeRows(client: pg.Client): Promise<void> {
  for (const [table, row] of Object.entries(ROWS)) {
    const columns = Object.keys(row).map((c) => `"${c}"`)
    const values = columns.map((_, i) => `$${i + 1}`)
    await client.query(
      `insert into "${table}" (${columns.join(', ')}) values (${values.join(', ')})`,
      Object.values(row),
    )
  }
}

/** The columns `ROWS` names, read back from each table's rows with the same first column. */
async function readRows(client: pg.Client): Promise<Record<string, unknown[]>> {
  const read: Record<string, unknown[]> = {}
  for (const [table, row] of Object.entries(ROWS)) {
    const [key = '', ...rest] = Object.keys(row)
    const columns = [key, ...rest].map((c) => `"${c}"`)
    // bigint columns come back as strings, so they compare with the strings written.
    const result = await client.query(`select ${columns.join(', ')} from "${table}" where "${key}" = $1`, [
      Object.values(row)[0],
    ])
    read[table] = result.rows
  }
  return read
}

const expectedRows = () => Object.fromEntries(Object.entries(ROWS).map(([table, row]) => [table, [row]]))

describe('the migrations', () => {
  // The migrator runs only migrations newer than the newest it has run, so one listed out of order would never run.
  it('are listed oldest first, each made after the one before', () => {
    const times = journal.entries.map((e) => e.when)
    expect(times).toEqual(times.toSorted((a, b) => a - b))
    expect(new Set(times).size).toBe(times.length)
  })

  it('apply in order to a fresh database, which then keeps a person, their workspace, brand and design', async () => {
    const url = await freshDatabase()
    expect(await applyMigrations(url, MIGRATIONS)).toBe(journal.entries.length)
    await withClient(url, writeRows)
    expect(await withClient(url, readRows)).toEqual(expectedRows())
  }, 60_000)

  it('keep a Before agent version, named by its agent, of the design', async () => {
    const url = await freshDatabase()
    await applyMigrations(url, MIGRATIONS)
    const version = {
      id: 'version-kept',
      design_id: 'design-kept',
      kind: 'beforeAgent',
      name: 'Claude (agent)',
      sync_id: 'sync-kept',
      seq: '2',
      schema_version: 1,
      state: Buffer.from('{"meta":{"name":"Spring sale"}}'),
    }
    const read = await withClient(url, async (client) => {
      await writeRows(client)
      const columns = Object.keys(version)
      await client.query(
        `insert into design_versions (${columns.map((c) => `"${c}"`).join(', ')}) values (${columns.map((_, i) => `$${i + 1}`).join(', ')})`,
        Object.values(version),
      )
      const result = await client.query(
        `select ${columns.map((c) => `"${c}"`).join(', ')} from design_versions where id = $1`,
        [version.id],
      )
      return result.rows
    })
    expect(read).toEqual([version])
  }, 60_000)

  it('give a brand kit saved before text styles none, and keep the rest of it', async () => {
    const at = journal.entries.findIndex((e) => e.tag.endsWith('brand-text-styles'))
    expect(at).toBeGreaterThan(0)
    const url = await freshDatabase()
    await applyMigrations(url, await firstMigrations(at))
    const colors = [{ token: 'primary', name: 'Primary', value: '#14213DFF' }]
    const fonts = [{ token: 'heading', name: 'Heading', family: 'Lora' }]
    await withClient(url, async (client) => {
      await writeRows(client)
      await client.query(
        'insert into brand_kits (brand_id, workspace_id, colors, fonts, voice) values ($1, $2, $3, $4, $5)',
        ['brand-kept', 'workspace-kept', JSON.stringify(colors), JSON.stringify(fonts), 'Warm'],
      )
    })
    await applyMigrations(url, MIGRATIONS)
    const kits = await withClient(url, async (client) => {
      const result = await client.query(
        'select colors, fonts, voice, text_styles from brand_kits where brand_id = $1',
        ['brand-kept'],
      )
      return result.rows
    })
    expect(kits).toEqual([{ colors, fonts, voice: 'Warm', text_styles: [] }])
  }, 60_000)

  it('give each kind of AI call a default model, keep as a flow override each step model that differs from it, and drop the old step rows', async () => {
    const at = journal.entries.findIndex((e) => e.tag.endsWith('ai-kind-models'))
    expect(at).toBeGreaterThan(0)
    const url = await freshDatabase()
    await applyMigrations(url, await firstMigrations(at))
    // An admin moved the round plan to Sol before the change.
    const before = await withClient(url, async (client) => {
      await client.query(`update ai_step_models set model = 'gpt-6.2-sol' where step = 'round-plan'`)
      return (await client.query('select step, model, options from ai_step_models order by step')).rows
    })
    await applyMigrations(url, MIGRATIONS)
    const read = await withClient(url, async (client) => ({
      kinds: (await client.query('select kind, model from ai_kind_models order by kind')).rows,
      steps: (await client.query('select step, model, options from ai_step_models order by step')).rows,
    }))
    expect(read.kinds).toEqual([
      { kind: 'layer-split', model: 'ming-image-0.1-design-layer' },
      { kind: 'picture', model: 'muse-image-1.0' },
      { kind: 'text', model: 'gpt-6-luna' },
    ])
    const flow = read.steps.filter((row: { step: string }) => row.step.startsWith('flow.'))
    expect(flow).toEqual([
      { step: 'flow.draft-precise', model: 'gpt-image-2.5-sunburst', options: { quality: 'medium' } },
      { step: 'flow.layer-plan', model: 'gpt-6.2-sol', options: {} },
      { step: 'flow.refine', model: 'seedream-5.5', options: {} },
      { step: 'flow.resize', model: 'seedream-5.5', options: {} },
      { step: 'flow.round-plan', model: 'gpt-6.2-sol', options: {} },
      { step: 'flow.round-plan-full', model: 'gpt-6.2-sol', options: {} },
    ])
    // The rows the previous commit's worker read are gone once no merged code reads them.
    expect(before).toHaveLength(8)
    expect(read.steps.filter((row: { step: string }) => !row.step.startsWith('flow.'))).toEqual([])
  }, 60_000)

  it('give a grant given before layering sizes 512 px, run the full round plan on Sol, and keep a design’s brief, AI frames and refines until the design goes', async () => {
    const at = journal.entries.findIndex((e) => e.tag.endsWith('ai-flow-briefs-frames'))
    expect(at).toBeGreaterThan(0)
    const url = await freshDatabase()
    await applyMigrations(url, await firstMigrations(at))
    await withClient(url, async (client) => {
      await writeRows(client)
      await client.query(
        `insert into ai_grants (id, workspace_id, source, amount, usage_rate, expires_at) values ('grant-kept', 'workspace-kept', 'gift', 1000000, 1000000, now() + interval '30 days')`,
      )
    })
    await applyMigrations(url, MIGRATIONS)
    const read = await withClient(url, async (client) => {
      const grants = (await client.query('select id, amount, layer_size from ai_grants')).rows
      const model = (await client.query(`select model from ai_step_models where step = 'flow.round-plan-full'`)).rows
      const plan = { brand: 'Warm. Facts: "Harbour Coffee"', ads: [] }
      await client.query(
        `insert into ai_briefs (id, workspace_id, brand_id, design_id, section_id, words, picture_keys, width, height, mode, plan, created_by)
         values ('brief-kept', 'workspace-kept', 'brand-kept', 'design-kept', 'section-kept', 'Spring sale', '{k1,k2}', 1080, 1080, 'fast', $1, 'user-kept')`,
        [JSON.stringify(plan)],
      )
      await client.query(
        `insert into ai_frames (design_id, frame_id, brief_id, job_id, call_index, kind) values ('design-kept', 'frame-kept', 'brief-kept', 'job-kept', 1, 'draft')`,
      )
      await client.query(
        `insert into ai_refines (id, design_id, frame_id, message, job_id) values ('refine-kept', 'design-kept', 'frame-kept', 'Bigger price', 'job-refine')`,
      )
      const kept = {
        briefs: (await client.query('select words, picture_keys, plan from ai_briefs')).rows,
        frames: (await client.query('select frame_id, state from ai_frames')).rows,
        refines: (await client.query('select message from ai_refines')).rows,
      }
      const refused = await client
        .query(`update ai_grants set layer_size = 768 where id = 'grant-kept'`)
        .then(() => false)
        .catch(() => true)
      await client.query(`delete from design_saves where design_id = 'design-kept'`)
      await client.query(`delete from designs where id = 'design-kept'`)
      const left = (
        await client.query(
          'select (select count(*) from ai_briefs) + (select count(*) from ai_frames) + (select count(*) from ai_refines) as n',
        )
      ).rows
      return { grants, model, kept, refused, left }
    })
    expect(read.grants).toEqual([{ id: 'grant-kept', amount: '1000000', layer_size: 512 }])
    expect(read.model).toEqual([{ model: 'gpt-6.2-sol' }])
    expect(read.kept).toEqual({
      briefs: [
        { words: 'Spring sale', picture_keys: ['k1', 'k2'], plan: { brand: 'Warm. Facts: "Harbour Coffee"', ads: [] } },
      ],
      frames: [{ frame_id: 'frame-kept', state: 'waiting' }],
      refines: [{ message: 'Bigger price' }],
    })
    expect(read.refused).toBe(true)
    expect(read.left).toEqual([{ n: '0' }])
  }, 60_000)

  it('give a job saved before the finish lease no holder', async () => {
    const at = journal.entries.findIndex((e) => e.tag.endsWith('ai-finish-lease'))
    expect(at).toBeGreaterThan(0)
    const url = await freshDatabase()
    await applyMigrations(url, await firstMigrations(at))
    await withClient(url, async (client) => {
      await writeRows(client)
      await client.query(
        `insert into ai_jobs (id, workspace_id, member_id, kind, input) values ('job-kept', 'workspace-kept', 'user-kept', 'layering', '{}')`,
      )
    })
    await applyMigrations(url, MIGRATIONS)
    const jobs = await withClient(
      url,
      async (client) => (await client.query('select id, finish_holder, finish_until from ai_jobs')).rows,
    )
    expect(jobs).toEqual([{ id: 'job-kept', finish_holder: null, finish_until: null }])
  }, 60_000)

  it('add the fast tier’s and Terra’s prices and Terra’s sellers, keeping a price and a seller order an admin set', async () => {
    const at = journal.entries.findIndex((e) => e.tag.endsWith('ai-fast-tier-and-terra-prices'))
    expect(at).toBeGreaterThan(0)
    const terra = (client: pg.Client) =>
      client.query(
        `select seller, unit, price_per_million::int as price from ai_prices where model = 'gpt-6.1-terra' and seller = 'openai' order by unit`,
      )
    const sellers = (client: pg.Client) =>
      client.query(`select seller, position from model_sellers where model = 'gpt-6.1-terra' order by position`)
    const seeded = await freshDatabase()
    await applyMigrations(seeded, MIGRATIONS)
    const read = await withClient(seeded, async (client) => ({
      prices: (await terra(client)).rows,
      sellers: (await sellers(client)).rows,
      fast: (
        await client.query(
          `select model, price_per_million::int as price from ai_prices where seller = 'openai' and unit = 'fast-output-token' order by model`,
        )
      ).rows,
    }))
    expect(read.prices).toEqual([
      { seller: 'openai', unit: 'cached-input-token', price: 50_000 },
      { seller: 'openai', unit: 'fast-cached-input-token', price: 100_000 },
      { seller: 'openai', unit: 'fast-input-token', price: 2_000_000 },
      { seller: 'openai', unit: 'fast-output-token', price: 10_000_000 },
      { seller: 'openai', unit: 'input-token', price: 1_000_000 },
      { seller: 'openai', unit: 'output-token', price: 5_000_000 },
    ])
    expect(read.sellers).toEqual([
      { seller: 'openai', position: 1 },
      { seller: 'zenmux', position: 2 },
      { seller: 'openrouter', position: 3 },
    ])
    expect(read.fast).toEqual([
      { model: 'gpt-6-luna', price: 1_000_000 },
      { model: 'gpt-6.1-terra', price: 10_000_000 },
      { model: 'gpt-6.2-sol', price: 20_000_000 },
    ])
    // An admin priced Terra's input at OpenAI and sold Terra through OpenRouter alone, before the migration.
    const changed = await freshDatabase()
    await applyMigrations(changed, await firstMigrations(at))
    await withClient(changed, async (client) => {
      await client.query(
        `insert into ai_prices (seller, model, unit, currency, price_per_million, fee) values ('openai', 'gpt-6.1-terra', 'input-token', 'USD', 1234567, 0)`,
      )
      await client.query(
        `insert into model_sellers (model, seller, position, seller_model) values ('gpt-6.1-terra', 'openrouter', 1, 'openai/gpt-6.1-terra')`,
      )
    })
    await applyMigrations(changed, MIGRATIONS)
    const kept = await withClient(changed, async (client) => ({
      input: (await terra(client)).rows.find((row) => row.unit === 'input-token'),
      fastInput: (await terra(client)).rows.find((row) => row.unit === 'fast-input-token'),
      sellers: (await sellers(client)).rows,
    }))
    // The fast price follows the admin's own standard price.
    expect(kept.fastInput).toEqual({ seller: 'openai', unit: 'fast-input-token', price: 2_469_134 })
    expect(kept.input).toEqual({ seller: 'openai', unit: 'input-token', price: 1_234_567 })
    expect(kept.sellers).toEqual([{ seller: 'openrouter', position: 1 }])
  }, 60_000)

  // From the second migration on: each runs over rows written under the ones before it.
  for (const [index, { tag }] of journal.entries.entries()) {
    if (index === 0) continue
    it(`${tag} keeps the rows written under the migrations before it`, async () => {
      const url = await freshDatabase()
      expect(await applyMigrations(url, await firstMigrations(index))).toBe(index)
      await withClient(url, writeRows)
      expect(await applyMigrations(url, await firstMigrations(index + 1))).toBe(index + 1)
      expect(await withClient(url, readRows)).toEqual(expectedRows())
    }, 60_000)
  }
})
