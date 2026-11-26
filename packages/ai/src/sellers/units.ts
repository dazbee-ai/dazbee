// The units each seller's adapter reports, by kind of call, by the seller's model where the adapter branches
// on it, and by the speed tier a call asks for where the seller bills its fast tier apart. Read with no seller's
// key, so the API checks prices against them without putting sellers in use; each adapter's test checks that what
// it reports is in this list.
import type { CallKind, UsageUnit } from '@dazbee/schema'

import { FAST_UNITS, type Tier } from './tiers.ts'

/** The units a seller reports for a kind of call: for every model, or for the models a test picks. */
interface Declared {
  seller: string
  kind: CallKind
  /** Only the seller's models this takes, when the adapter branches on the model. */
  models?: (sellerModel: string) => boolean
  units: UsageUnit[]
  /** The units it also reports for a call that asks for the fast tier, which may run on either tier. */
  fast?: UsageUnit[]
}

/** The units of a text call through the Responses API or chat completions. */
const TEXT: UsageUnit[] = ['input-token', 'cached-input-token', 'output-token']

/** The units of a text call that ran on the fast tier. */
const FAST_TEXT: UsageUnit[] = Object.values(FAST_UNITS)

/** The units of a GPT Image call: text and picture tokens in, picture tokens out. */
const GPT_IMAGE: UsageUnit[] = ['input-token', 'image-input-token', 'image-output-token']

/** The units of a call billed per picture made and per reference picture. */
const PER_PICTURE: UsageUnit[] = ['picture', 'reference-picture']

/** Every seller's declared units, the first entry that takes a seller, kind and model winning. */
const DECLARED: Declared[] = [
  { seller: 'openai', kind: 'text', units: TEXT, fast: FAST_TEXT },
  { seller: 'openai', kind: 'picture', units: GPT_IMAGE },
  { seller: 'meta', kind: 'picture', units: ['picture'] },
  { seller: 'openrouter', kind: 'text', units: TEXT },
  { seller: 'openrouter', kind: 'picture', units: PER_PICTURE },
  { seller: 'zenmux', kind: 'text', units: TEXT },
  { seller: 'zenmux', kind: 'picture', models: (m) => m.startsWith('bytedance/'), units: PER_PICTURE },
  { seller: 'zenmux', kind: 'picture', models: (m) => m.startsWith('meta/'), units: ['picture'] },
  { seller: 'zenmux', kind: 'picture', units: GPT_IMAGE },
  { seller: 'pixazo', kind: 'picture', units: PER_PICTURE },
  { seller: 'modal', kind: 'layer-split', units: ['gpu-second', 'cpu-core-second', 'memory-gib-second'] },
]

/**
 * The units `seller` reports for a `kind` call of its model `sellerModel` that asks for `tier`: an empty list
 * for a kind it makes no call of, and undefined for a seller with no declared units (only tests' sellers).
 */
export function declaredUnits(
  seller: string,
  kind: CallKind,
  sellerModel: string,
  tier: Tier = 'standard',
): UsageUnit[] | undefined {
  if (!DECLARED.some((d) => d.seller === seller)) return undefined
  const declared = DECLARED.find((d) => d.seller === seller && d.kind === kind && (!d.models || d.models(sellerModel)))
  if (!declared) return []
  return tier === 'fast' && declared.fast ? [...declared.units, ...declared.fast] : declared.units
}
