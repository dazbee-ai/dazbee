// The admin page's AI section: the AI settings, the currency rates, the price list and the seller order as an
// admin reads and sets them, finding a workspace, a gift, a workspace's grants and ledger, the AI functions with
// their presets, what each preset measured and the preset each mode uses, a pick and an AI function's picks, and
// AI's costs by day, AI feature, AI function, preset, model and seller. Money is a decimal number of rupees or of
// the seller's currency; the tables keep whole millionths.
import { z } from 'zod'

import {
  AiFunction,
  CallKind,
  GrantSource,
  LayerSplitSize,
  LedgerKind,
  PickMode,
  Seller,
  SELLERS,
  UsageUnit,
  UtcDay,
} from './ai.ts'

/** An amount of money on the admin page: rupees, or a seller's currency, as a decimal; kept as whole millionths. */
const Money = z.number().nonnegative().max(1_000_000_000)

/**
 * When what a save changes was last changed, as the page that sends it read it, or null when there was none
 * yet: a save from a page that read anything else is refused, so a second tab never overwrites a newer save.
 */
const Since = z.iso.datetime().nullable().optional()

/** The AI settings an admin sets: the usage rate (1 is a rupee of allowance per rupee of real cost), amounts in rupees. */
export const AiSettingsInput = z.object({
  usageRate: z.number().positive().max(1000),
  spendingStop: Money,
  jobLimit: z.number().int().min(1).max(100),
  layerSplit512: Money,
  layerSplit1024: Money,
  since: Since,
})
export type AiSettingsInput = z.infer<typeof AiSettingsInput>

/** The AI settings as an admin reads them, with today's real cost of AI calls (IST) and whether the spending stop is in force. */
export const AiSettingsView = AiSettingsInput.omit({ since: true }).extend({
  spentToday: z.number(),
  stopped: z.boolean(),
  updatedAt: z.iso.datetime(),
})
export type AiSettingsView = z.infer<typeof AiSettingsView>

/** A currency's code, such as USD. */
export const CurrencyCode = z.string().regex(/^[A-Z]{3}$/)

/** What one unit of a currency costs in rupees, the bank's forex fee included. */
export const CurrencyRateInput = z.object({ rate: z.number().positive().max(1_000_000), since: Since })
export type CurrencyRateInput = z.infer<typeof CurrencyRateInput>

/** A currency's rate as an admin reads it. */
export const CurrencyRateView = CurrencyRateInput.omit({ since: true }).extend({
  currency: z.string(),
  updatedAt: z.iso.datetime(),
})
export type CurrencyRateView = z.infer<typeof CurrencyRateView>

/** A model's name as the price list and the seller order keep it, such as seedream-5.5. */
export const ModelName = z
  .string()
  .trim()
  .regex(/^[a-z0-9][a-z0-9._-]{0,99}$/)

/**
 * One row of the price list as an admin sets it: what `seller` charges for a million units of `unit` on
 * `model`, in its currency, and the GST or fee its bill adds as a share of the price (0.18 is 18%).
 */
export const AiPriceInput = z.object({
  seller: Seller,
  model: ModelName,
  unit: UsageUnit,
  currency: CurrencyCode,
  pricePerMillion: Money,
  fee: z.number().min(0).max(1),
  since: Since,
})
export type AiPriceInput = z.infer<typeof AiPriceInput>

/** A price-list row as an admin reads it. */
export const AiPriceView = AiPriceInput.omit({ since: true }).extend({
  seller: z.string(),
  model: z.string(),
  updatedAt: z.iso.datetime(),
})
export type AiPriceView = z.infer<typeof AiPriceView>

/** A seller of a model, with its own name for the model when it differs. */
const ModelSeller = z.object({ seller: z.string(), sellerModel: z.string().nullable() })

/** A model's sellers, tried in this order. */
export const ModelSellersView = z.object({ model: z.string(), sellers: z.array(ModelSeller) })
export type ModelSellersView = z.infer<typeof ModelSellersView>

/**
 * A model's sellers in the order an admin sets, each at most once, with the order the page read (none for a
 * model not sold yet): a save from a page that read another order is refused.
 */
export const ModelSellersInput = z.object({
  sellers: z
    .array(z.object({ seller: Seller, sellerModel: z.string().trim().min(1).max(200).nullable() }))
    .min(1)
    .max(SELLERS.length)
    .refine((sellers) => new Set(sellers.map((s) => s.seller)).size === sellers.length, 'Name each seller once'),
  was: z.array(ModelSeller).max(SELLERS.length).optional(),
})
export type ModelSellersInput = z.infer<typeof ModelSellersInput>

/** A workspace an admin found by its name or a member's email, with its members' emails. */
export const AiWorkspace = z.object({ id: z.string(), name: z.string(), emails: z.array(z.string()) })
export type AiWorkspace = z.infer<typeof AiWorkspace>

/**
 * A gift of allowance, in rupees, to a workspace: it expires when the IST day `expiresOn` ends, and its layers are
 * made at `layerSize`.
 */
export const GiftInput = z.object({
  amount: Money.positive(),
  expiresOn: UtcDay,
  note: z.string().trim().max(500).default(''),
  /** The size in px a layering job splits at when its hold draws from this grant first. */
  layerSize: LayerSplitSize.default(512),
})
export type GiftInput = z.infer<typeof GiftInput>

/** A grant as an admin reads it: amounts in rupees of allowance, the usage rate it keeps, what is left, and its layering size. */
export const AiGrantView = z.object({
  id: z.string(),
  source: GrantSource,
  amount: z.number(),
  usageRate: z.number(),
  left: z.number(),
  expiresAt: z.iso.datetime(),
  live: z.boolean(),
  note: z.string(),
  layerSize: LayerSplitSize,
  givenBy: z.string().nullable(),
  createdAt: z.iso.datetime(),
})
export type AiGrantView = z.infer<typeof AiGrantView>

/** A row of the allowance ledger, in rupees of allowance: minus for a hold or a charge, plus for a give-back. */
export const AiLedgerRow = z.object({
  id: z.number(),
  grantId: z.string(),
  jobId: z.string(),
  callId: z.string().nullable(),
  kind: LedgerKind,
  amount: z.number(),
  createdAt: z.iso.datetime(),
})
export type AiLedgerRow = z.infer<typeof AiLedgerRow>

/** A workspace's allowance: what is left on its live grants, every grant, and its newest ledger rows. */
export const AiAllowanceView = z.object({
  workspace: AiWorkspace,
  left: z.number(),
  grants: z.array(AiGrantView),
  ledger: z.array(AiLedgerRow),
})
export type AiAllowanceView = z.infer<typeof AiAllowanceView>

/**
 * What a preset's own calls measured: how many were done, the real cost in rupees and the seconds one call is
 * taken to need, which its hold and its wait are worked out from, how many of its tries were cut off at their
 * ceiling, and how many failed any other way. While it has no done call, the cost and seconds are its first guess.
 */
export const AiPresetMeasured = z.object({
  done: z.number().int(),
  cost: z.number(),
  seconds: z.number(),
  cutOffs: z.number().int(),
  failures: z.number().int(),
  firstGuess: z.boolean(),
})
export type AiPresetMeasured = z.infer<typeof AiPresetMeasured>

/**
 * A preset as an admin reads it: its name, its model, the settings it passes the seller, whether it has a prompt
 * of its own in place of its AI function's, and what its calls measured.
 */
export const AiPresetView = z.object({
  name: z.string(),
  model: z.string(),
  settings: z.record(z.string(), z.unknown()),
  ownPrompt: z.boolean(),
  measured: AiPresetMeasured,
})
export type AiPresetView = z.infer<typeof AiPresetView>

/**
 * The preset a mode uses for an AI function: whether a pick or the code chose it, the newest pick's preset when
 * the running code has none by that name (the code's own choice then runs), and when the newest pick was made,
 * null with none, which the next pick names as its `since`.
 */
export const AiModePreset = z.object({
  mode: PickMode,
  preset: z.string(),
  source: z.enum(['pick', 'code']),
  lacking: z.string().nullable(),
  pickedAt: z.iso.datetime().nullable(),
})
export type AiModePreset = z.infer<typeof AiModePreset>

/**
 * An AI function as an admin reads it: its name and kind of call, its presets, the first its default, and the
 * preset each mode uses, or the one it uses under no mode when no mode changes it.
 */
export const AiFunctionView = z.object({
  function: z.string(),
  kind: CallKind,
  presets: z.array(AiPresetView),
  modes: z.array(AiModePreset),
})
export type AiFunctionView = z.infer<typeof AiFunctionView>

/** A pick to add: the preset `mode` uses for `function` from the next job on. */
export const AiPickInput = z.object({
  function: AiFunction,
  mode: PickMode,
  preset: z.string().min(1).max(100),
  since: Since,
})
export type AiPickInput = z.infer<typeof AiPickInput>

/** A pick in an AI function's history: its mode and preset, the email of the admin who made it, and when. */
export const AiPickView = z.object({
  id: z.number().int(),
  mode: z.string(),
  preset: z.string(),
  setBy: z.string().nullable(),
  setAt: z.iso.datetime(),
})
export type AiPickView = z.infer<typeof AiPickView>

/**
 * What AI cost on one UTC day for one AI feature, AI function, preset, model and seller: how many tries, how many
 * delivered, their real cost in rupees, and what workspaces were charged for them in rupees of real cost (for the
 * layer split, its fixed amount).
 */
export const AiCostRow = z.object({
  day: UtcDay,
  feature: z.string(),
  function: z.string(),
  preset: z.string(),
  model: z.string(),
  seller: z.string(),
  calls: z.number().int(),
  done: z.number().int(),
  realCost: z.number(),
  charged: z.number(),
})
export type AiCostRow = z.infer<typeof AiCostRow>

/** Whole millionths of an amount given as a decimal, as the AI tables keep money and rates. */
export function toMillionths(amount: number): bigint {
  return BigInt(Math.round(amount * 1e6))
}

/** An amount kept in whole millionths, as a decimal. */
export function fromMillionths(amount: bigint): number {
  return Number(amount) / 1e6
}
