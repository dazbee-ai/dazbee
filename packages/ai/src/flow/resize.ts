// Other sizes: the draft's picture redrawn once per size picked, each its own call, so a size that fails can be
// tried again alone.
import type { Db, Tx } from '@dazbee/db'
import type { CallInput, ResizeInput } from '@dazbee/schema'

import { callSize, pictureLimits, shapeOf } from '../call-size.ts'
import type { JobEnd } from '../jobs.ts'
import { stepModel } from '../seller-route.ts'
import { pictureName } from './assets.ts'
import type { DeclaredCall } from './holds.ts'
import type { FlowRun } from './run.ts'

/**
 * The resize instruction: a plain stand-in for the resize prompt, which is not written yet. `{shape}` is the size's
 * shape in words.
 */
export const RESIZE_STAND_IN = 'The same ad, re-laid out as a {shape} image.'

/** Runs a resize: one redraw per size, size `n` being call `n`. */
export async function runResize(run: FlowRun, input: ResizeInput): Promise<JobEnd | null> {
  const name = await pictureName(run.db, run.workspace, input.briefId, '')
  const calls = await resizeCalls(run.db, input)
  await run.all(calls.map((call, n) => run.call(n, call.step, call.input, name)))
  return null
}

/** The calls a resize declares: one redraw per size. */
export async function resizeCalls(db: Db | Tx, input: ResizeInput): Promise<DeclaredCall[]> {
  const { model } = await stepModel(db, 'flow.resize')
  return input.sizes.map((size) => ({ step: 'flow.resize', input: redrawCall(input.pictureKey, size, model) }))
}

/** The redraw of `picture` at `size`, at the model's call size. */
function redrawCall(picture: string, size: { width: number; height: number }, model: string): CallInput {
  return {
    kind: 'picture',
    prompt: RESIZE_STAND_IN.replace('{shape}', () => shapeOf(size)),
    pictures: [picture],
    ...callSize(size, pictureLimits(model)),
  }
}
