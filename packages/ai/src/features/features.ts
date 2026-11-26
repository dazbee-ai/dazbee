// The features list: every AI feature, each what a person asks the AI for in one go, declared once as the AI
// functions it runs, in stages. A new feature on a kind of call we have is one line here, its AI function and its
// place on the screen.
import type { AiFeature } from '@dazbee/schema'

import { layering } from './layering.ts'
import { refine } from './refine.ts'
import { resize } from './resize.ts'
import { round, tryAgain } from './round.ts'
import type { AiFeatureDef } from './types.ts'

/** A feature's declaration, whatever its input and what it loads. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- each declaration checks its own input; the list holds them all
export type AnyFeature = AiFeatureDef<any, any>

/** Every AI feature's declaration. */
export const FEATURES: Record<AiFeature, AnyFeature> = {
  round,
  'more-like-this': round,
  'try-again': tryAgain,
  refine,
  resize,
  layering,
}
