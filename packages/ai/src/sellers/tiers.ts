// The speed tier a text call asks for, from its preset's settings, and its usage at a tier: a call that ran on
// the fast tier is reported in the fast token units, which the price list prices at the fast tier's price.
import type { Usage, UsageUnit } from '@dazbee/schema'

/** A speed tier: the seller's standard one, or its fast one, which answers sooner at a higher price. */
export type Tier = 'standard' | 'fast'

/** The speed tiers a preset's settings may ask for. */
export const TIERS: readonly Tier[] = ['standard', 'fast']

/** Each token unit's fast-tier unit. */
export const FAST_UNITS = {
  'input-token': 'fast-input-token',
  'cached-input-token': 'fast-cached-input-token',
  'cache-write-input-token': 'fast-cache-write-input-token',
  'output-token': 'fast-output-token',
} as const satisfies Partial<Record<UsageUnit, UsageUnit>>

/** The tier a preset's settings ask for: fast when `tier` is `fast`, otherwise standard. */
export function tierOf(options: Record<string, unknown>): Tier {
  return options.tier === 'fast' ? 'fast' : 'standard'
}

/** `usage` as counted at `tier`: at the fast tier, each token unit as its fast-tier unit. */
export function atTier(usage: Usage, tier: Tier): Usage {
  if (tier === 'standard') return usage
  return Object.fromEntries(
    Object.entries(usage).map(([unit, amount]) => [FAST_UNITS[unit as keyof typeof FAST_UNITS] ?? unit, amount]),
  )
}
