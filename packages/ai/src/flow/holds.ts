// What a flow job holds: each job kind declares the calls its script makes, each at the most it can cost, and
// `holdFor` prices their sum. A round holds its plan at the step's expected size and four pictures at the call size.
import type { Db, Tx } from '@dazbee/db'
import type { AiStep, CallInput, FlowJobInput } from '@dazbee/schema'

import { holdFor } from '../steps.ts'
import { layeringCalls } from './layering.ts'
import { refineCalls } from './refine.ts'
import { resizeCalls } from './resize.ts'
import { roundCalls, tryAgainCalls } from './round.ts'

/** A call a job declares for its hold: its AI step and its input at the most it can cost. */
export interface DeclaredCall {
  step: AiStep
  input: CallInput
}

/**
 * What `flow` of `workspace` holds, in millionths of a rupee of real cost. Throws for a try-again of a brief the
 * workspace hasn't.
 */
export async function flowHold(db: Db | Tx, workspace: string, flow: FlowJobInput): Promise<bigint> {
  return holdFor(db, await declaredCalls(db, workspace, flow))
}

/** The calls `flow` declares. */
export async function declaredCalls(db: Db | Tx, workspace: string, flow: FlowJobInput): Promise<DeclaredCall[]> {
  switch (flow.kind) {
    case 'round':
    case 'more-like-this':
      return roundCalls(db, flow.input)
    case 'try-again':
      return tryAgainCalls(db, workspace, flow.input)
    case 'refine':
      return refineCalls(db, flow.input)
    case 'resize':
      return resizeCalls(db, flow.input)
    case 'layering':
      return layeringCalls(flow.input)
  }
}
