'use server'

// What the admin page's AI section changes: the AI settings, a currency's rate, a price, a model's seller
// order, a kind's default model and an AI step's own model; a gift to a workspace; and a seller's usage file. The API answers anyone but
// an admin as if none of it existed, so each is an admin's only. Each gives why it was refused, in the
// person's language where the page knows the reason, and the section draws again with what changed.
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import {
  AiPriceInput,
  AiSettingsInput,
  AiStepModelInput,
  CallKind,
  CurrencyCode,
  CurrencyRateInput,
  GiftInput,
  ModelName,
  ModelSellersInput,
  Seller,
  SellerFileUpload,
  UnpricedModel,
  UsageUnit,
  WrongKind,
} from '@dazbee/schema'

import type { Messages } from '@/lib/i18n/en.ts'
import { format } from '@/lib/i18n/index.ts'
import { getMessages } from '@/lib/i18n/server.ts'
import { PILOT_AI_PATH } from '@/lib/pilot-host.ts'
import {
  giveAiGift,
  removeAiPrice,
  removeStepModel,
  setAiPrice,
  setAiSettings,
  setCurrencyRate,
  setKindModel,
  setModelSellers,
  setStepModel,
  uploadAiSellerFile,
} from '@/lib/server/admin-ai.ts'
import { type Refusal, refusalOf } from '@/lib/server/members.ts'

/** What an upload came to: the days the file covered, or why it was refused. */
export type UploadAnswer = { days: string[] } | { error: string }

export async function saveAiSettings(settings: AiSettingsInput): Promise<string | null> {
  return change(AiSettingsInput, settings, setAiSettings)
}

/** Saves a currency's rate, read when it was last changed at `since`, or null for a currency not added yet. */
export async function saveCurrencyRate(currency: string, rate: number, since: string | null): Promise<string | null> {
  return change(CurrencyRateInput.extend({ currency: CurrencyCode }), { currency, rate, since }, (valid) =>
    setCurrencyRate(valid.currency, { rate: valid.rate, since: valid.since }),
  )
}

export async function saveAiPrice(price: AiPriceInput): Promise<string | null> {
  return change(AiPriceInput, price, setAiPrice)
}

export async function removePrice(seller: string, model: string, unit: string): Promise<string | null> {
  return change(z.object({ seller: Seller, model: ModelName, unit: UsageUnit }), { seller, model, unit }, removeAiPrice)
}

export async function saveSellerOrder(model: string, order: ModelSellersInput): Promise<string | null> {
  return change(z.object({ model: ModelName, order: ModelSellersInput }), { model, order }, (valid) =>
    setModelSellers(valid.model, valid.order),
  )
}

/** Saves an AI step's model; a model of another kind is refused in the page's own words for it. */
export async function saveStepModel(step: string, choice: AiStepModelInput): Promise<string | null> {
  return change(
    z.object({ step: z.string().min(1).max(100), choice: AiStepModelInput }),
    { step, choice },
    (valid) => setStepModel(valid.step, valid.choice),
    wrongKindWords,
  )
}

/** Removes an AI step's own model, read when it was last changed at `since`, so the step runs its kind's default. */
export async function removeStepOverride(step: string, since: string | null): Promise<string | null> {
  return change(
    z.object({ step: z.string().min(1).max(100), since: z.iso.datetime().nullable() }),
    { step, since },
    (valid) => removeStepModel(valid.step, { since: valid.since }),
  )
}

/** Saves a kind's default model; a model of another kind is refused in the page's own words for it. */
export async function saveKindModel(kind: CallKind, choice: AiStepModelInput): Promise<string | null> {
  return change(
    z.object({ kind: CallKind, choice: AiStepModelInput }),
    { kind, choice },
    (valid) => setKindModel(valid.kind, valid.choice),
    wrongKindWords,
  )
}

export async function giveGift(workspaceId: string, gift: GiftInput): Promise<string | null> {
  return change(
    z.object({ workspaceId: z.string().min(1).max(200), gift: GiftInput }),
    { workspaceId, gift },
    (valid) => giveAiGift(valid.workspaceId, valid.gift),
  )
}

/** Uploads a seller's usage file, which checks each day it covers. */
export async function uploadSellerFile(upload: SellerFileUpload): Promise<UploadAnswer> {
  if (typeof upload.text === 'string' && upload.text.trim() === '') {
    return { error: (await getMessages()).pilotAi.checks.empty }
  }
  const valid = SellerFileUpload.safeParse(upload)
  if (!valid.success) return { error: (await getMessages()).pilotAi.invalid }
  let days: string[] = []
  const refusal = await refusalOf(async () => {
    days = (await uploadAiSellerFile(valid.data)).days
  })
  revalidatePath(PILOT_AI_PATH)
  return refusal ? { error: refusal.message } : { days }
}

/**
 * Checks `input` with `schema`, runs the change with it, then draws the section again; why it was refused, or
 * null. A refusal for something gone or changed meanwhile is the page's own words, as is one `explain` reads;
 * any other keeps the API's message.
 */
async function change<T extends z.ZodType>(
  schema: T,
  input: unknown,
  run: (valid: z.infer<T>) => Promise<unknown>,
  explain?: (refusal: Refusal, t: Messages['pilotAi']) => string | null,
): Promise<string | null> {
  const valid = schema.safeParse(input)
  if (!valid.success) return (await getMessages()).pilotAi.invalid
  const refusal = await refusalOf(() => run(valid.data))
  revalidatePath(PILOT_AI_PATH)
  if (!refusal) return null
  const t = (await getMessages()).pilotAi
  if (refusal.status === 404) return t.gone
  if (refusal.status === 409) return t.stale
  return explain?.(refusal, t) ?? refusal.message
}

/**
 * Why an AI step, or a kind's default, can't be a model of another kind, with the step's, the kinds' and the
 * units' names as the page shows them.
 */
function wrongKindWords(refusal: Refusal, t: Messages['pilotAi']): string | null {
  const unpriced = z.object({ unpriced: UnpricedModel }).safeParse(refusal.body)
  if (unpriced.success) return unpricedWords(unpriced.data.unpriced, t)
  const body = z.object({ wrongKind: WrongKind }).safeParse(refusal.body)
  if (!body.success) return null
  const { step, model, units, wants, is } = body.data.wrongKind
  const named = step && Object.hasOwn(t.steps, step) ? t.steps[step as keyof typeof t.steps] : step
  return format(step === undefined ? t.stepModels.wrongKindDefault : t.stepModels.wrongKind, {
    step: named ?? '',
    kind: t.stepModels.kindNames[wants],
    wants: t.stepModels.kinds[wants],
    model,
    is: is ? t.stepModels.kinds[is] : t.stepModels.kinds.none,
    units: units.map((unit) => t.units[unit]).join(', '),
  })
}

/** Why a model can't be chosen yet, with the sellers' and units' names as the page shows them. */
function unpricedWords({ model, sellers }: UnpricedModel, t: Messages['pilotAi']): string {
  if (sellers.length === 0) return format(t.stepModels.noPricedSeller, { model })
  const named = (words: Record<string, string>, name: string) => (Object.hasOwn(words, name) ? words[name] : name)
  const missing = sellers
    .map(({ seller, units }) =>
      format(t.stepModels.unpricedSeller, {
        seller: named(t.sellers, seller) ?? seller,
        units: units.map((unit) => t.units[unit]).join(', '),
      }),
    )
    .join('; ')
  return format(t.stepModels.unpriced, { model, missing })
}
