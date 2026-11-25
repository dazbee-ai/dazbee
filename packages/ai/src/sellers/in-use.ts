// Puts in use the adapter of every seller whose keys the environment sets.
import type { CostReport } from '../daily-check.ts'
import { metaSeller } from './meta.ts'
import { modalCostReport, modalSeller } from './modal.ts'
import { openaiCostReport, openaiSeller } from './openai.ts'
import { openrouterCostReport, openrouterSeller } from './openrouter.ts'
import { pixazoSeller } from './pixazo.ts'
import { type SellerAdapter, useSeller } from './seller.ts'
import { zenmuxCostReport, zenmuxSeller } from './zenmux.ts'

/** Each seller's key settings, all of which it needs, and its adapter on their values. */
const SELLERS: { keys: string[]; adapter: (values: string[]) => SellerAdapter }[] = [
  { keys: ['OPENAI_API_KEY'], adapter: ([apiKey = '']) => openaiSeller(apiKey) },
  { keys: ['MUSE_API_KEY'], adapter: ([apiKey = '']) => metaSeller(apiKey) },
  { keys: ['OPENROUTER_API_KEY'], adapter: ([apiKey = '']) => openrouterSeller(apiKey) },
  { keys: ['ZENMUX_API_KEY'], adapter: ([apiKey = '']) => zenmuxSeller(apiKey) },
  { keys: ['PIXAZO_API_KEY'], adapter: ([apiKey = '']) => pixazoSeller(apiKey) },
  { keys: ['MODAL_TOKEN_ID', 'MODAL_TOKEN_SECRET'], adapter: ([id = '', secret = '']) => modalSeller(id, secret) },
]

/** Puts in use each seller whose keys `env` all sets; the sellers put in use. */
export function useSellersOf(env: NodeJS.ProcessEnv = process.env): string[] {
  const used: string[] = []
  for (const { keys, adapter } of SELLERS) {
    const values = keys.map((key) => env[key] ?? '')
    if (values.some((value) => !value)) continue
    const seller = adapter(values)
    useSeller(seller)
    used.push(seller.seller)
  }
  return used
}

/**
 * The cost report of each seller whose report keys `env` sets: OPENAI_ADMIN_API_KEY (with OPENAI_PROJECT_ID to
 * read one project), OPENROUTER_MANAGEMENT_API_KEY (with OPENROUTER_KEY_HASH for one API key),
 * ZENMUX_PLATFORM_API_KEY (with ZENMUX_KEY_ID for one API key), and Modal's token.
 */
export function reportsOf(env: NodeJS.ProcessEnv = process.env): Map<string, CostReport> {
  const reports = new Map<string, CostReport>()
  if (env.OPENAI_ADMIN_API_KEY) {
    reports.set('openai', openaiCostReport({ adminKey: env.OPENAI_ADMIN_API_KEY, projectId: env.OPENAI_PROJECT_ID }))
  }
  if (env.OPENROUTER_MANAGEMENT_API_KEY) {
    const keyHash = env.OPENROUTER_KEY_HASH
    reports.set('openrouter', openrouterCostReport({ managementKey: env.OPENROUTER_MANAGEMENT_API_KEY, keyHash }))
  }
  if (env.ZENMUX_PLATFORM_API_KEY) {
    reports.set('zenmux', zenmuxCostReport({ managementKey: env.ZENMUX_PLATFORM_API_KEY, keyId: env.ZENMUX_KEY_ID }))
  }
  if (env.MODAL_TOKEN_ID && env.MODAL_TOKEN_SECRET) {
    reports.set('modal', modalCostReport(env.MODAL_TOKEN_ID, env.MODAL_TOKEN_SECRET))
  }
  return reports
}
