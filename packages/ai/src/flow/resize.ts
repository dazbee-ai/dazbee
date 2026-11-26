// Other sizes: the draft's picture redrawn once per size picked, each its own call, so a size that fails can be
// tried again alone.
import type { CallInput, ResizeInput } from '@dazbee/schema'

import { callSize, pictureLimits, shapeOf } from '../call-size.ts'
import type { JobEnd } from '../jobs.ts'
import { pictureName } from './assets.ts'
import type { DeclaredCall } from './holds.ts'
import type { FlowRun } from './run.ts'

/** Runs a resize: one redraw per size, size `n` being call `n`. */
export async function runResize(run: FlowRun, input: ResizeInput): Promise<JobEnd | null> {
  const name = await pictureName(run.db, run.workspace, input.briefId, '')
  const prompt = run.prompt('resize')
  const model = run.preset('resize').model
  await run.all(
    input.sizes.map((size, n) => run.call(n, 'resize', redrawCall(input.pictureKey, size, prompt, model), name)),
  )
  return null
}

/** The calls a resize declares: one redraw per size. */
export function resizeCalls(input: ResizeInput): DeclaredCall[] {
  return input.sizes.map(() => ({ fn: 'resize' }))
}

/** The redraw of `picture` at `size`, at the model's call size, with the resize prompt's `{shape}` filled in. */
function redrawCall(
  picture: string,
  size: { width: number; height: number },
  prompt: string,
  model: string,
): CallInput {
  return {
    kind: 'picture',
    prompt: prompt.replace('{shape}', () => shapeOf(size)),
    pictures: [picture],
    ...callSize(size, pictureLimits(model)),
  }
}
