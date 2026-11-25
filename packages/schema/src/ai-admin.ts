// The admin page's AI section: the AI settings, the currency rates, the price list, the seller order and each
// AI step's model as an admin reads and sets them, finding a workspace, a gift, a workspace's grants and
// ledger, and AI's costs by day, AI step, model and seller. Money is a decimal number of rupees or of the
// seller's currency; the tables keep whole millionths.
import { z } from 'zod'

import { CallKind, GrantSource, LedgerKind, Seller, SELLERS, UsageUnit, UtcDay } from './ai.ts'

/** An amount of money on the admin page: rupees, or a seller's currency, as a decimal; kept as whole millionths. */
const Money = z.number().nonnegative().max(1_000_000_000)

/** The AI settings an admin sets: the usage rate (1 is a rupee of allowance per rupee of real cost), amounts in rupees. */
export const AiSettingsInput = z.object({
  usageRate: z.number().positive().max(1000),
  spendingStop: Money,
  jobLimit: z.number().int().min(1).max(100),
  layerSplit512: Money,
  layerSplit1024: Money,
})
export type AiSettingsInput = z.infer<typeof AiSettingsInput>

/** The AI settings as an admin reads them, with today's real cost of AI calls (IST) and whether the spending stop is in force. */
export const AiSettingsView = AiSettingsInput.extend({
  spentToday: z.number(),
  stopped: z.boolean(),
  updatedAt: z.iso.datetime(),
})
export type AiSettingsView = z.infer<typeof AiSettingsView>

/** A currency's code, such as USD. */
export const CurrencyCode = z.string().regex(/^[A-Z]{3}$/)

/** What one unit of a currency costs in rupees, the bank's forex fee included. */
export const CurrencyRateInput = z.object({ rate: z.number().positive().max(1_000_000) })
export type CurrencyRateInput = z.infer<typeof CurrencyRateInput>

/** A currency's rate as an admin reads it. */
export const CurrencyRateView = CurrencyRateInput.extend({ currency: z.string(), updatedAt: z.iso.datetime() })
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
})
export type AiPriceInput = z.infer<typeof AiPriceInput>

/** A price-list row as an admin reads it. */
export const AiPriceView = AiPriceInput.extend({ seller: z.string(), model: z.string(), updatedAt: z.iso.datetime() })
export type AiPriceView = z.infer<typeof AiPriceView>

/** A seller of a model, with its own name for the model when it differs. */
const ModelSeller = z.object({ seller: z.string(), sellerModel: z.string().nullable() })

/** A model's sellers, tried in this order. */
export const ModelSellersView = z.object({ model: z.string(), sellers: z.array(ModelSeller) })
export type ModelSellersView = z.infer<typeof ModelSellersView>

/** A model's sellers in the order an admin sets, each at most once. */
export const ModelSellersInput = z.object({
  sellers: z
    .array(z.object({ seller: Seller, sellerModel: z.string().trim().min(1).max(200).nullable() }))
    .min(1)
    .max(SELLERS.length)
    .refine((sellers) => new Set(sellers.map((s) => s.seller)).size === sellers.length, 'Name each seller once'),
})
export type ModelSellersInput = z.infer<typeof ModelSellersInput>

/** The model an AI step runs, with the options its call passes the model, such as a picture's quality. */
export const AiStepModelInput = z.object({
  model: ModelName,
  options: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
})
export type AiStepModelInput = z.infer<typeof AiStepModelInput>

/**
 * An AI step's model as an admin reads it, with the step's kind of call and the priced models of that kind,
 * the only ones it may run.
 */
export const AiStepModelView = z.object({
  step: z.string(),
  kind: CallKind,
  model: z.string(),
  models: z.array(z.string()),
  options: z.record(z.string(), z.unknown()),
  updatedAt: z.iso.datetime(),
})
export type AiStepModelView = z.infer<typeof AiStepModelView>

/** A workspace an admin found by its name or a member's email, with its members' emails. */
export const AiWorkspace = z.object({ id: z.string(), name: z.string(), emails: z.array(z.string()) })
export type AiWorkspace = z.infer<typeof AiWorkspace>

/** A gift of allowance, in rupees, to a workspace: it expires when the IST day `expiresOn` ends. */
export const GiftInput = z.object({
  amount: Money.positive(),
  expiresOn: UtcDay,
  note: z.string().trim().max(500).default(''),
})
export type GiftInput = z.infer<typeof GiftInput>

/** A grant as an admin reads it: amounts in rupees of allowance, the usage rate it keeps, and what is left. */
export const AiGrantView = z.object({
  id: z.string(),
  source: GrantSource,
  amount: z.number(),
  usageRate: z.number(),
  left: z.number(),
  expiresAt: z.iso.datetime(),
  live: z.boolean(),
  note: z.string(),
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
 * What AI cost on one UTC day for one AI step, model and seller: how many tries, how many delivered, their
 * real cost in rupees, and what workspaces were charged for them in rupees of real cost (for the layer split,
 * its fixed amount).
 */
export const AiCostRow = z.object({
  day: UtcDay,
  step: z.string(),
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
