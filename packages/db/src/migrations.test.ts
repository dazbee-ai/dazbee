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

  it('give a grant given before layering sizes 512 px, and keep a design’s brief, AI frames and refines until the design goes', async () => {
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
      return { grants, kept, refused, left }
    })
    expect(read.grants).toEqual([{ id: 'grant-kept', amount: '1000000', layer_size: 512 }])
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
    // Up to the finish lease alone: a later migration empties the jobs.
    await applyMigrations(url, await firstMigrations(at + 1))
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

  it('empty the AI run history, leaving the price list, seller order, settings, grants and designs as they were', async () => {
    const at = journal.entries.findIndex((e) => e.tag.endsWith('ai-run-history-wiped'))
    expect(at).toBeGreaterThan(0)
    const url = await freshDatabase()
    await applyMigrations(url, await firstMigrations(at))
    const WIPED = [
      'ai_jobs',
      'ai_calls',
      'ai_ledger',
      'ai_briefs',
      'ai_frames',
      'ai_refines',
      'ai_daily_checks',
      'ai_seller_files',
    ]
    const count = async (client: pg.Client, table: string) =>
      Number((await client.query<{ count: string }>(`select count(*) from "${table}"`)).rows[0]?.count)
    const kept = async (client: pg.Client) => ({
      prices: (await client.query('select * from ai_prices order by seller, model, unit')).rows,
      sellers: (await client.query('select * from model_sellers order by model, position')).rows,
      rates: (await client.query('select currency, rate from currency_rates order by currency')).rows,
      settings: (await client.query('select usage_rate, spending_stop, job_limit from ai_settings')).rows,
      grants: (await client.query('select id, amount, usage_rate, layer_size from ai_grants')).rows,
    })
    const before = await withClient(url, async (client) => {
      await writeRows(client)
      await client.query(
        `insert into ai_grants (id, workspace_id, source, amount, usage_rate, expires_at) values ('grant-kept', 'workspace-kept', 'gift', 1000000, 1000000, now() + interval '30 days')`,
      )
      await client.query(
        `insert into ai_jobs (id, workspace_id, member_id, kind, input) values ('job-wiped', 'workspace-kept', 'user-kept', 'round', '{}')`,
      )
      await client.query(
        `insert into ai_calls (id, job_id, workspace_id, call_index, try, attempt, step, model, seller) values ('call-wiped', 'job-wiped', 'workspace-kept', 0, 1, 1, 'flow.round-plan', 'gpt-6-luna', 'openai')`,
      )
      await client.query(
        `insert into ai_ledger (grant_id, job_id, kind, amount) values ('grant-kept', 'job-wiped', 'hold', -400000)`,
      )
      await client.query(
        `insert into ai_briefs (id, workspace_id, brand_id, design_id, section_id, words, width, height, mode, created_by) values ('brief-wiped', 'workspace-kept', 'brand-kept', 'design-kept', 'section', 'Fresh every morning', 1080, 1080, 'fast', 'user-kept')`,
      )
      await client.query(
        `insert into ai_frames (design_id, frame_id, brief_id, job_id, call_index, kind) values ('design-kept', 'frame', 'brief-wiped', 'job-wiped', 1, 'draft')`,
      )
      await client.query(
        `insert into ai_refines (id, design_id, frame_id, message, job_id) values ('refine-wiped', 'design-kept', 'frame', 'Bigger price', 'job-wiped')`,
      )
      await client.query(
        `insert into ai_daily_checks (seller, day, currency, our_cost, state) values ('openai', '2026-11-25', 'USD', 1200, 'ok')`,
      )
      await client.query(
        `insert into ai_seller_files (id, seller, name, uploaded_by, currency, days) values ('file-wiped', 'meta', 'usage.csv', 'user-kept', 'INR', '{}')`,
      )
      for (const table of WIPED) expect(await count(client, table), table).toBe(1)
      return kept(client)
    })
    // Up to the wipe alone: a later migration drops the step and the two tables of models.
    await applyMigrations(url, await firstMigrations(at + 1))
    await withClient(url, async (client) => {
      for (const table of WIPED) expect(await count(client, table), table).toBe(0)
      expect(await kept(client)).toEqual(before)
      expect(await readRows(client)).toEqual(expectedRows())
      // With the ledger empty, what is left on the grant is its whole amount.
      const left = await client.query<{ left: string }>(
        `select (g.amount + coalesce((select sum(amount) from ai_ledger l where l.grant_id = g.id), 0))::text as left from ai_grants g where g.id = 'grant-kept'`,
      )
      expect(left.rows[0]?.left).toBe('1000000')
      // The last build's worker still logs a call under its step, and its API still saves a job with no presets.
      await client.query(
        `insert into ai_jobs (id, workspace_id, member_id, kind, input) values ('job-old', 'workspace-kept', 'user-kept', 'round', '{}')`,
      )
      await client.query(
        `insert into ai_calls (id, job_id, workspace_id, call_index, try, attempt, step, model, seller) values ('call-old', 'job-old', 'workspace-kept', 0, 1, 1, 'flow.round-plan', 'gpt-6-luna', 'openai')`,
      )
      // A call is logged with no step.
      await client.query(
        `insert into ai_calls (id, job_id, workspace_id, call_index, try, attempt, function, preset, model, seller) values ('call-new', 'job-new', 'workspace-kept', 0, 1, 1, 'round-plan', 'light-luna', 'gpt-6-luna', 'openai')`,
      )
      expect(await count(client, 'ai_calls')).toBe(2)
    })
  }, 60_000)

  it('drop the call log’s step and the two tables of models, delete a call logged with no AI function or without its feature, keep the rest, and take the calls the build before logs', async () => {
    const at = journal.entries.findIndex((e) => e.tag.endsWith('ai-model-tables-and-step-dropped'))
    expect(at).toBeGreaterThan(0)
    const url = await freshDatabase()
    await applyMigrations(url, await firstMigrations(at))
    /** Logs a call as the build before does: under its AI feature, AI function, preset and kind, with no step. */
    const log = (client: pg.Client, id: string, callIndex: number) =>
      client.query(
        `insert into ai_calls (id, job_id, workspace_id, call_index, try, attempt, feature, function, preset, kind, settings, prompt_hash, model, seller)
         values ($1, 'job-kept', 'workspace-kept', $2, 1, 1, 'round', 'round-plan', 'light-luna', 'text', '{"effort":"low"}', 'hash', 'gpt-6-luna', 'openai')`,
        [id, callIndex],
      )
    const calls = async (client: pg.Client) =>
      (
        await client.query<{ id: string }>(
          'select id, call_index, feature, function, preset, kind, settings, prompt_hash, model, seller, state from ai_calls order by id',
        )
      ).rows
    const before = await withClient(url, async (client) => {
      await writeRows(client)
      await log(client, 'call-kept-1', 0)
      await log(client, 'call-kept-2', 1)
      // Logged under a step alone, with no AI function.
      await client.query(
        `insert into ai_calls (id, job_id, workspace_id, call_index, try, attempt, step, model, seller) values ('call-no-function', 'job-old', 'workspace-kept', 0, 1, 1, 'flow.round-plan', 'gpt-6-luna', 'openai')`,
      )
      // With an AI function and a preset but no AI feature and no kind, as no build's worker logs a call.
      await client.query(
        `insert into ai_calls (id, job_id, workspace_id, call_index, try, attempt, function, preset, model, seller) values ('call-no-feature', 'job-old', 'workspace-kept', 1, 1, 1, 'round-plan', 'light-luna', 'gpt-6-luna', 'openai')`,
      )
      await client.query(
        `insert into ai_picks (function, mode, preset, set_by) values ('round-plan', 'precise', 'light-luna', 'user-kept')`,
      )
      const rows = await calls(client)
      expect(rows.map((row) => row.id)).toEqual(['call-kept-1', 'call-kept-2', 'call-no-feature', 'call-no-function'])
      return rows.filter((row) => row.id.startsWith('call-kept-'))
    })
    expect(await applyMigrations(url, await firstMigrations(at + 1))).toBe(at + 1)
    await withClient(url, async (client) => {
      expect(before).toHaveLength(2)
      expect(await calls(client)).toEqual(before)
      const tables = await client.query(
        `select to_regclass('ai_kind_models')::text as kinds, to_regclass('ai_step_models')::text as steps`,
      )
      expect(tables.rows).toEqual([{ kinds: null, steps: null }])
      const columns = await client.query(
        `select column_name, is_nullable from information_schema.columns where table_name = 'ai_calls' and column_name in ('step', 'feature', 'function', 'preset', 'kind') order by column_name`,
      )
      expect(columns.rows).toEqual([
        { column_name: 'feature', is_nullable: 'NO' },
        { column_name: 'function', is_nullable: 'NO' },
        { column_name: 'kind', is_nullable: 'NO' },
        { column_name: 'preset', is_nullable: 'NO' },
      ])
      // The build before keeps running on it: its worker logs a call and ends it, its API reads a job's calls by
      // AI function and the costs by AI feature and AI function, and its jobs read their picks.
      await log(client, 'call-after', 2)
      await client.query(
        `update ai_calls set state = 'done', real_cost = 540000, charge_cost = 540000, ended_at = now() where id = 'call-after'`,
      )
      const read = await client.query(
        `select call_index, function, state, error from ai_calls where job_id = 'job-kept' order by call_index, try`,
      )
      expect(read.rows).toEqual([
        { call_index: 0, function: 'round-plan', state: 'running', error: null },
        { call_index: 1, function: 'round-plan', state: 'running', error: null },
        { call_index: 2, function: 'round-plan', state: 'done', error: null },
      ])
      const costs = await client.query(
        `select coalesce(feature, '') as feature, coalesce(function, '') as function, model, seller, count(*)::int as calls from ai_calls group by feature, function, model, seller`,
      )
      expect(costs.rows).toEqual([
        { feature: 'round', function: 'round-plan', model: 'gpt-6-luna', seller: 'openai', calls: 3 },
      ])
      const picks = await client.query(
        'select distinct on (function, mode) function, mode, preset from ai_picks order by function, mode, id desc',
      )
      expect(picks.rows).toEqual([{ function: 'round-plan', mode: 'precise', preset: 'light-luna' }])
      expect(await readRows(client)).toEqual(expectedRows())
    })
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
