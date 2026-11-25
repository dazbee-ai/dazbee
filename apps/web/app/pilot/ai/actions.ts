'use server'

// What the admin page's AI section changes: the AI settings, a currency's rate, a price, a model's seller
// order and an AI step's model; a gift to a workspace; and a seller's usage file. The API answers anyone but
// an admin as if none of it existed, so each is an admin's only. Each gives why it was refused, in the
// person's language where the page knows the reason, and the section draws again with what changed.
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import {
  AiPriceInput,
  AiSettingsInput,
  AiStepModelInput,
  CurrencyCode,
  CurrencyRateInput,
  GiftInput,
  ModelName,
  ModelSellersInput,
  Seller,
  SellerFileUpload,
  UsageUnit,
} from '@dazbee/schema'

import { getMessages } from '@/lib/i18n/server.ts'
import { PILOT_AI_PATH } from '@/lib/pilot-host.ts'
import {
  giveAiGift,
  removeAiPrice,
  setAiPrice,
  setAiSettings,
  setCurrencyRate,
  setModelSellers,
  setStepModel,
  uploadAiSellerFile,
} from '@/lib/server/admin-ai.ts'
import { refusalOf } from '@/lib/server/members.ts'

/** What an upload came to: the days the file covered, or why it was refused. */
export type UploadAnswer = { days: string[] } | { error: string }

export async function saveAiSettings(settings: AiSettingsInput): Promise<string | null> {
  return change(AiSettingsInput, settings, setAiSettings)
}

export async function saveCurrencyRate(currency: string, rate: number): Promise<string | null> {
  return change(CurrencyRateInput.extend({ currency: CurrencyCode }), { currency, rate }, (valid) =>
    setCurrencyRate(valid.currency, valid.rate),
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

export async function saveStepModel(step: string, choice: AiStepModelInput): Promise<string | null> {
  return change(z.object({ step: z.string().min(1).max(100), choice: AiStepModelInput }), { step, choice }, (valid) =>
    setStepModel(valid.step, valid.choice),
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
 * null. A refusal for something gone meanwhile is the page's own words; any other keeps the API's message.
 */
async function change<T extends z.ZodType>(
  schema: T,
  input: unknown,
  run: (valid: z.infer<T>) => Promise<unknown>,
): Promise<string | null> {
  const valid = schema.safeParse(input)
  if (!valid.success) return (await getMessages()).pilotAi.invalid
  const refusal = await refusalOf(() => run(valid.data))
  revalidatePath(PILOT_AI_PATH)
  if (!refusal) return null
  return refusal.status === 404 ? (await getMessages()).pilotAi.gone : refusal.message
}
