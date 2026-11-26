'use server'

// What the admin page's AI section changes: the AI settings, a currency's rate, a price, a model's seller
// order; the preset a mode uses, by a pick; a gift to a workspace; and a seller's usage file. The API answers anyone but
// an admin as if none of it existed, so each is an admin's only. Each gives why it was refused, in the
// person's language where the page knows the reason, and the section draws again with what changed.
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import {
  AiPickInput,
  AiPriceInput,
  AiSettingsInput,
  CurrencyCode,
  CurrencyRateInput,
  GiftInput,
  ModelName,
  ModelSellersInput,
  Seller,
  SellerFileUpload,
  UsageUnit,
} from '@dazbee/schema'

import type { Messages } from '@/lib/i18n/en.ts'
import { getMessages } from '@/lib/i18n/server.ts'
import { PILOT_AI_PATH } from '@/lib/pilot-host.ts'
import {
  addAiPick,
  giveAiGift,
  removeAiPrice,
  setAiPrice,
  setAiSettings,
  setCurrencyRate,
  setModelSellers,
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

/**
 * Adds a pick: the preset `mode` uses for the AI function from the next job on, from a page that read the newest
 * pick for them as made at `since`, or null with none.
 */
export async function pickPreset(pick: {
  function: string
  mode: string
  preset: string
  since: string | null
}): Promise<string | null> {
  return change(AiPickInput, pick, addAiPick, (refusal, t) =>
    refusal.status === 409 ? t.aiFunctions.pickedMeanwhile : null,
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
  const explained = explain?.(refusal, t)
  if (explained) return explained
  if (refusal.status === 404) return t.gone
  if (refusal.status === 409) return t.stale
  return refusal.message
}
