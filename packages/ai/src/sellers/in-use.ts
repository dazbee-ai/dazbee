// Puts in use the adapter of every seller whose keys the environment sets; in development, each wrapped to record
// its answers (AI_RECORD_DIR), or in their place replay sellers that answer from a recording (AI_REPLAY_DIR).
import { resolve } from 'node:path'

import type { CostReport } from '../daily-check.ts'
import { metaSeller } from './meta.ts'
import { modalCostReport, modalSeller } from './modal.ts'
import { openaiCostReport, openaiSeller } from './openai.ts'
import { openrouterCostReport, openrouterSeller } from './openrouter.ts'
import { pixazoSeller } from './pixazo.ts'
import { recordingSeller, replaySellers } from './recording.ts'
import { type SellerAdapter, useSeller } from './seller.ts'
import { zenmuxCostReport, zenmuxSeller } from './zenmux.ts'

/**
 * A development worker's AI recording: every seller's answers written to `dir` as they come, or every call answered
 * from the recording in `dir`, `speed` times faster than it was recorded.
 */
export type AiRecording = { mode: 'record'; dir: string } | { mode: 'replay'; dir: string; speed: number }

/** Each seller: its name, its key settings, all of which it needs, and its adapter on their values. */
const SELLERS: { seller: string; keys: string[]; adapter: (values: string[]) => SellerAdapter }[] = [
  { seller: 'openai', keys: ['OPENAI_API_KEY'], adapter: ([apiKey = '']) => openaiSeller(apiKey) },
  { seller: 'meta', keys: ['MUSE_API_KEY'], adapter: ([apiKey = '']) => metaSeller(apiKey) },
  { seller: 'openrouter', keys: ['OPENROUTER_API_KEY'], adapter: ([apiKey = '']) => openrouterSeller(apiKey) },
  { seller: 'zenmux', keys: ['ZENMUX_API_KEY'], adapter: ([apiKey = '']) => zenmuxSeller(apiKey) },
  { seller: 'pixazo', keys: ['PIXAZO_API_KEY'], adapter: ([apiKey = '']) => pixazoSeller(apiKey) },
  {
    seller: 'modal',
    keys: ['MODAL_TOKEN_ID', 'MODAL_TOKEN_SECRET'],
    adapter: ([id = '', secret = '']) => modalSeller(id, secret),
  },
]

/** How many times faster than recorded a replayed call answers, when AI_REPLAY_SPEED doesn't say. */
const REPLAY_SPEED = 10

/**
 * Puts in use each seller whose keys `env` all sets, each recording its answers when AI_RECORD_DIR is set; with
 * AI_REPLAY_DIR set, a replay seller under every seller's name in their place, reading no key. The sellers put in
 * use. Throws as `aiRecordingOf` does.
 */
export function useSellersOf(env: NodeJS.ProcessEnv = process.env): string[] {
  const recording = aiRecordingOf(env)
  if (recording?.mode === 'replay') {
    const names = SELLERS.map((s) => s.seller)
    for (const seller of replaySellers(names, recording.dir, recording.speed)) useSeller(seller)
    return names
  }
  const used: string[] = []
  for (const { keys, adapter } of SELLERS) {
    const values = keys.map((key) => env[key] ?? '')
    if (values.some((value) => !value)) continue
    const seller = adapter(values)
    useSeller(recording ? recordingSeller(seller, recording.dir) : seller)
    used.push(seller.seller)
  }
  return used
}

/**
 * The AI recording `env` turns on: AI_RECORD_DIR records, AI_REPLAY_DIR replays at AI_REPLAY_SPEED (10 by
 * default); null when neither is set. Throws for either with NODE_ENV=production, for both at once, and for a
 * speed that is not a number above 0.
 */
export function aiRecordingOf(env: NodeJS.ProcessEnv = process.env): AiRecording | null {
  const record = env.AI_RECORD_DIR
  const replay = env.AI_REPLAY_DIR
  if (!record && !replay) return null
  if (env.NODE_ENV === 'production') throw new Error('AI_RECORD_DIR and AI_REPLAY_DIR are never set in production')
  if (record && replay) throw new Error('AI_RECORD_DIR and AI_REPLAY_DIR are not set together')
  if (record) return { mode: 'record', dir: resolve(record) }
  const speed = Number(env.AI_REPLAY_SPEED || REPLAY_SPEED)
  if (!(speed > 0)) throw new Error('AI_REPLAY_SPEED is a number above 0')
  return { mode: 'replay', dir: resolve(replay ?? ''), speed }
}

/**
 * The cost report of each seller whose report keys `env` sets: OPENAI_ADMIN_API_KEY (with OPENAI_PROJECT_ID to
 * read one project), OPENROUTER_MANAGEMENT_API_KEY (with OPENROUTER_KEY_HASH for one API key),
 * ZENMUX_PLATFORM_API_KEY (with ZENMUX_KEY_ID for one API key), and Modal's token (with MODAL_ENVIRONMENT for one
 * environment). None when replaying.
 */
export function reportsOf(env: NodeJS.ProcessEnv = process.env): Map<string, CostReport> {
  const reports = new Map<string, CostReport>()
  // A replaying worker reads no seller's key.
  if (aiRecordingOf(env)?.mode === 'replay') return reports
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
    reports.set('modal', modalCostReport(env.MODAL_TOKEN_ID, env.MODAL_TOKEN_SECRET, env.MODAL_ENVIRONMENT))
  }
  return reports
}
