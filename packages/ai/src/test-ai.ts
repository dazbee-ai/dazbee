// Fixtures for the AI tests, against Postgres from Docker Compose (`docker compose up -d --wait postgres`):
// workspaces, jobs and grants of their own, and models with test sellers and prices under names no other
// test uses, so test files running side by side never meet. Imported by tests only.
import { eq } from 'drizzle-orm'
import { afterAll } from 'vitest'

import { aiGrants, aiJobs, aiLedger, aiPrices, modelSellers, newId, openDatabase } from '@dazbee/db'
import { loadCanvasKit } from '@dazbee/renderer/node'
import type { AiJobState, CallKind, UsageUnit } from '@dazbee/schema'

import type { PictureFiles } from './call.ts'
import { AI_FUNCTION_DEFS } from './functions/ai-function.ts'
import type { AiFunctionDef, Preset } from './functions/types.ts'
import { type SellerAdapter, useSeller } from './sellers/seller.ts'
import { DATABASE_URL } from './test-database.ts'

/** A price row for a test model, per million units in millionths of the currency. */
export interface TestPrice {
  unit: UsageUnit
  pricePerMillion: bigint
  fee?: number
  currency?: string
}

/** A seller of a test model: its adapter, if one is in use, and its prices (token prices for an adapter by default). */
export interface TestModelSeller {
  seller: string
  adapter?: SellerAdapter
  prices?: TestPrice[]
}

/** US$1 for a million input tokens and US$2 for a million output tokens, with no fee. */
export const TOKEN_PRICES: TestPrice[] = [
  { unit: 'input-token', pricePerMillion: 1_000_000n },
  { unit: 'output-token', pricePerMillion: 2_000_000n },
]

/**
 * A text model's prices at a seller that bills its fast tier apart: US$1 a million input tokens and US$2 output at
 * the standard tier, twice that at the fast tier, cached input at a tenth and input written to the cache at one
 * and a quarter, with no fee.
 */
export const TIERED_PRICES: TestPrice[] = [
  ...TOKEN_PRICES,
  { unit: 'cached-input-token', pricePerMillion: 100_000n },
  { unit: 'cache-write-input-token', pricePerMillion: 1_250_000n },
  { unit: 'fast-input-token', pricePerMillion: 2_000_000n },
  { unit: 'fast-cached-input-token', pricePerMillion: 200_000n },
  { unit: 'fast-cache-write-input-token', pricePerMillion: 2_500_000n },
  { unit: 'fast-output-token', pricePerMillion: 4_000_000n },
]

/** One rupee, in millionths. */
export const RUPEE = 1_000_000n

/** The dollar's starting rate, in millionths of a rupee. */
export const DOLLAR = 96_310_000n

export const { db, close } = openDatabase(DATABASE_URL)

afterAll(close)

/** A workspace id no other test uses. */
export const newWorkspace = () => `ws-${newId()}`

/** A seller name no other test uses. */
export const newSeller = (name: string) => `test-${name}-${newId()}`

/** Saves an AI job of `workspace`, running on its first attempt unless told otherwise; its id. */
export async function addJob(
  workspace: string,
  { state = 'running', attempt = 1 }: { state?: AiJobState; attempt?: number } = {},
): Promise<string> {
  const id = newId()
  await db
    .insert(aiJobs)
    .values({ id, workspaceId: workspace, memberId: 'member', kind: 'calls', state, attempt, input: {} })
  return id
}

/** Changes a job's state or attempt, as a run of the worker would. */
export async function setJob(job: string, change: { state?: AiJobState; attempt?: number }): Promise<void> {
  await db.update(aiJobs).set(change).where(eq(aiJobs.id, job))
}

/** Gives `workspace` a grant of `amount` at `rate` (millionths) that expires in `days`; its id. */
export async function addGrant(
  workspace: string,
  amount: bigint,
  { rate = RUPEE, days = 30 }: { rate?: bigint; days?: number } = {},
): Promise<string> {
  const id = newId()
  await db.insert(aiGrants).values({
    id,
    workspaceId: workspace,
    source: 'gift',
    amount,
    usageRate: rate,
    expiresAt: new Date(Date.now() + days * 86_400_000),
  })
  return id
}

/** A job's ledger rows, oldest first, as grant, kind and amount. */
export async function ledgerOf(job: string) {
  return db
    .select({ grant: aiLedger.grantId, kind: aiLedger.kind, amount: aiLedger.amount, call: aiLedger.callId })
    .from(aiLedger)
    .where(eq(aiLedger.jobId, job))
    .orderBy(aiLedger.id)
}

/** The name of the one preset a test's AI function has. */
export const TEST_PRESET = 'test'

/**
 * A test-only AI function of `kind` whose one preset, `TEST_PRESET`, runs a new model sold by `sellers` in order,
 * or `model`, one sold already, with `settings`, a ceiling, a first guess and a fixed charge when given; the
 * function's name and the model's. The sellers' adapters are put in use.
 */
export async function addFunction(
  sellers: (SellerAdapter | TestModelSeller)[],
  {
    kind = 'text',
    settings = {},
    ceiling,
    guess = { cost: 100_000n, seconds: 5 },
    model = `test-model-${newId()}`,
    fixedCharge,
  }: {
    kind?: CallKind
    settings?: Record<string, unknown>
    ceiling?: number
    guess?: Preset['guess']
    model?: string
    fixedCharge?: AiFunctionDef['fixedCharge']
  } = {},
): Promise<{ fn: string; model: string }> {
  const fn = `test-function-${newId()}`
  AI_FUNCTION_DEFS[fn] = {
    kind,
    ...(ceiling === undefined ? {} : { ceiling }),
    ...(fixedCharge ? { fixedCharge } : {}),
    presets: { [TEST_PRESET]: { model, settings, guess } },
  }
  for (const [position, given] of sellers.entries()) {
    const entry: TestModelSeller = 'call' in given ? { seller: given.seller, adapter: given } : given
    if (entry.adapter) useSeller(entry.adapter)
    await db.insert(modelSellers).values({ model, seller: entry.seller, position })
    await addPrices(entry.seller, model, entry.prices ?? (entry.adapter ? TOKEN_PRICES : []))
  }
  return { fn, model }
}

/** Gives a test's AI function's preset other `settings`, as a new preset of another function would have. */
export function setSettings(fn: string, settings: Record<string, unknown>): void {
  const preset = AI_FUNCTION_DEFS[fn]?.presets[TEST_PRESET]
  if (!preset) throw new Error(`no test AI function ${fn}`)
  preset.settings = settings
}

/** Writes price rows for `model` at `seller`. */
export async function addPrices(seller: string, model: string, prices: TestPrice[]): Promise<void> {
  if (prices.length === 0) return
  await db.insert(aiPrices).values(
    prices.map((p) => ({
      seller,
      model,
      unit: p.unit,
      currency: p.currency ?? 'USD',
      pricePerMillion: p.pricePerMillion,
      fee: p.fee ?? 0,
    })),
  )
}

/** Picture storage in memory. */
export function memoryFiles(): PictureFiles & { saved: Map<string, Uint8Array> } {
  const saved = new Map<string, Uint8Array>()
  return {
    saved,
    read: async (key) => saved.get(key) ?? new Uint8Array(),
    save: async (bytes) => {
      const key = `test/${newId()}`
      saved.set(key, bytes)
      return key
    },
  }
}

/**
 * A PNG of `width` × `height` filled with `color` (RGBA, 0 to 255), or transparent with a `color` square over its
 * top-left quarter when `quarter` is set.
 */
export async function pngOf(
  width: number,
  height: number,
  color: [number, number, number, number],
  { quarter = false }: { quarter?: boolean } = {},
): Promise<Uint8Array> {
  const ck = await loadCanvasKit()
  const surface = ck.MakeSurface(width, height)
  if (!surface) throw new Error('no surface')
  const paint = new ck.Paint()
  paint.setColor(ck.Color(color[0], color[1], color[2], color[3] / 255))
  const canvas = surface.getCanvas()
  canvas.clear(ck.TRANSPARENT)
  canvas.drawRect(ck.XYWHRect(0, 0, quarter ? width / 2 : width, quarter ? height / 2 : height), paint)
  const snapshot = surface.makeImageSnapshot()
  const png = snapshot.encodeToBytes()
  snapshot.delete()
  paint.delete()
  surface.delete()
  if (!png) throw new Error('no PNG')
  return png
}
