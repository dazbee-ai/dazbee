// Other sizes: the draft's picture redrawn once per size picked, each its own call, so a size that fails can be
// tried again alone.
import type { ResizeInput } from '@dazbee/schema'

import { redrawCall } from '../functions/resize.ts'
import { pictureName } from './assets.ts'
import type { AiFeatureDef, FeatureCall } from './types.ts'

/** A resize: one redraw per size, size `n` being call `n`, all side by side. */
export const resize: AiFeatureDef<ResizeInput> = {
  shape: (input) => ({ count: input.sizes.length, reference: false }),
  stages: (shape) => [
    Array.from({ length: shape.count }, (_, n): FeatureCall<ResizeInput, undefined> => ({
      index: n,
      fn: 'resize',
      build({ input, prompt, model }) {
        const size = input.sizes[n]
        return size ? redrawCall(input.pictureKey, size, prompt, model) : null
      },
    })),
  ],
  name: (on, input) => pictureName(on.db, on.workspace, input.briefId, ''),
}
