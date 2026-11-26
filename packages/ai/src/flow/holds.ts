// What a job holds: each call it may make at its preset's cost, or its AI function's fixed charge, summed and
// raised by the hold's margin. Each flow job kind declares the calls its script makes.
import type { Db, Tx } from '@dazbee/db'
import type { AiFunction, CallInput, FlowJobInput } from '@dazbee/schema'

import { aiFunctionDef, presetOf } from '../functions/ai-function.ts'
import { presetNumbers } from '../measured.ts'
import { aiSettingsOf } from '../settings.ts'
import { layeringCalls } from './layering.ts'
import { refineCalls } from './refine.ts'
import { resizeCalls } from './resize.ts'
import { roundCalls, tryAgainCalls } from './round.ts'

/** A call a job declares for its hold: its AI function, and its input where its charge depends on it. */
export interface DeclaredCall {
  fn: AiFunction
  input?: CallInput
}

/** A call to hold for: its AI function, the name of its preset, and its input where its charge depends on it. */
export interface HeldCall {
  fn: string
  preset: string
  input?: CallInput | undefined
}

/** How much more than its calls' cost a job holds. */
const HOLD_MARGIN = { times: 5n, per: 4n }

/**
 * What `flow` of `workspace` holds with `presets`, in millionths of a rupee of real cost. Throws for a try-again of
 * a brief the workspace hasn't.
 */
export async function flowHold(
  db: Db | Tx,
  workspace: string,
  flow: FlowJobInput,
  presets: Record<string, string>,
): Promise<bigint> {
  const calls = await declaredCalls(db, workspace, flow)
  return holdOf(
    db,
    calls.map(({ fn, input }) => ({ fn, preset: presets[fn] ?? '', input })),
  )
}

/**
 * What `calls` hold, in millionths of a rupee of real cost: each call's fixed charge where its AI function has one
 * and the call gives its input, otherwise what one call of its preset costs, summed, times 1.25. Fails for a
 * preset the code doesn't have.
 */
export async function holdOf(db: Db | Tx, calls: HeldCall[]): Promise<bigint> {
  const settings = await aiSettingsOf(db)
  // Each preset's cost, read once however many calls run it.
  const costs = new Map<string, bigint>()
  let total = 0n
  for (const { fn, preset: name, input } of calls) {
    const def = aiFunctionDef(fn)
    if (def.fixedCharge && input) {
      total += def.fixedCharge(settings, input)
      continue
    }
    const preset = presetOf(fn, name)
    if (!preset) throw new Error(`the AI function ${fn} has no preset ${name}`)
    const key = `${fn}/${name}`
    const cost = costs.get(key) ?? (await presetNumbers(db, fn, name, preset)).cost
    costs.set(key, cost)
    total += cost
  }
  return (total * HOLD_MARGIN.times + HOLD_MARGIN.per - 1n) / HOLD_MARGIN.per
}

/** The calls `flow` declares. */
export async function declaredCalls(db: Db | Tx, workspace: string, flow: FlowJobInput): Promise<DeclaredCall[]> {
  switch (flow.kind) {
    case 'round':
    case 'more-like-this':
      return roundCalls(flow.input)
    case 'try-again':
      return tryAgainCalls(db, workspace, flow.input)
    case 'refine':
      return refineCalls()
    case 'resize':
      return resizeCalls(flow.input)
    case 'layering':
      return layeringCalls(flow.input)
  }
}
