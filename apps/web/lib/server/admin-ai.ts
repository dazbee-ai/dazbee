// The API's calls for the admin page's AI section and the AI part of the admin pages' overview, from the web
// app's server only. The API answers each one 404 for anyone but an admin, as if there were no such page.
import 'server-only'

import { cache } from 'react'
import { z } from 'zod'

import {
  AiAllowanceView,
  AiCostRow,
  AiGrantView,
  type AiPriceInput,
  AiPriceView,
  type AiSettingsInput,
  AiSettingsView,
  type AiStepModelInput,
  AiStepModelView,
  AiWorkspace,
  CurrencyRateView,
  DailyCheck,
  type GiftInput,
  LastChecked,
  type ModelSellersInput,
  ModelSellersView,
  OutOfMoney,
  SellerFileResult,
  type SellerFileUpload,
  UnknownCalls,
  type UsageUnit,
} from '@dazbee/schema'

import { ApiFailure, call } from './api.ts'

/** Everything the AI section shows, with the costs, the daily check and the unknown calls of the days from `from` to `to`. */
export interface AiPage {
  settings: AiSettingsView
  rates: CurrencyRateView[]
  prices: AiPriceView[]
  modelSellers: ModelSellersView[]
  stepModels: AiStepModelView[]
  costs: AiCostRow[]
  checks: DailyCheck[]
  unknownCalls: UnknownCalls[]
  outOfMoney: OutOfMoney[]
  lastChecked: LastChecked[]
}

/** What the overview shows of AI: the settings with today's spend, the days' costs, today's, the daily check and the unknown calls. */
export interface AiOverviewData {
  settings: AiSettingsView
  costs: AiCostRow[]
  today: AiCostRow[]
  checks: DailyCheck[]
  unknownCalls: UnknownCalls[]
  outOfMoney: OutOfMoney[]
}

/**
 * The AI section's data for the UTC days `from` to `to`, or null when the person is not an admin. Asked once
 * per request, by the page and its title.
 */
export const findAiPage = cache(async (from: string, to: string): Promise<AiPage | null> => {
  const days = new URLSearchParams({ from, to })
  try {
    const [settings, rates, prices, modelSellers, stepModels, costs, checks, unknownCalls, outOfMoney, lastChecked] =
      await Promise.all([
        call(AiSettingsView, '/admin/ai/settings'),
        call(CurrencyRateView.array(), '/admin/ai/currency-rates'),
        call(AiPriceView.array(), '/admin/ai/prices'),
        call(ModelSellersView.array(), '/admin/ai/model-sellers'),
        call(AiStepModelView.array(), '/admin/ai/step-models'),
        call(AiCostRow.array(), `/admin/ai/costs?${days}`),
        call(DailyCheck.array(), `/admin/ai/daily-checks?${days}`),
        call(UnknownCalls.array(), `/admin/ai/unknown-calls?${days}`),
        call(OutOfMoney.array(), '/admin/ai/out-of-money'),
        call(LastChecked.array(), '/admin/ai/last-checked'),
      ])
    return { settings, rates, prices, modelSellers, stepModels, costs, checks, unknownCalls, outOfMoney, lastChecked }
  } catch (e) {
    if (e instanceof ApiFailure && e.status === 404) return null
    throw e
  }
})

/**
 * The overview's AI data for the UTC days `from` to `to`, with the costs of the UTC day `today`, or null when
 * the person is not an admin. Asked once per request, by the page and its title.
 */
export const findAiOverview = cache(async (from: string, to: string, today: string): Promise<AiOverviewData | null> => {
  const days = new URLSearchParams({ from, to })
  try {
    const [settings, costs, todays, checks, unknownCalls, outOfMoney] = await Promise.all([
      call(AiSettingsView, '/admin/ai/settings'),
      call(AiCostRow.array(), `/admin/ai/costs?${days}`),
      call(AiCostRow.array(), `/admin/ai/costs?${new URLSearchParams({ from: today, to: today })}`),
      call(DailyCheck.array(), `/admin/ai/daily-checks?${days}`),
      call(UnknownCalls.array(), `/admin/ai/unknown-calls?${days}`),
      call(OutOfMoney.array(), '/admin/ai/out-of-money'),
    ])
    return { settings, costs, today: todays, checks, unknownCalls, outOfMoney }
  } catch (e) {
    if (e instanceof ApiFailure && e.status === 404) return null
    throw e
  }
})

/** The workspaces whose name or a member's email holds `text`, at least 2 characters of it. */
export const findAiWorkspaces = (text: string) =>
  call(AiWorkspace.array(), `/admin/ai/workspaces?${new URLSearchParams({ q: text })}`)

/** The workspace's grants and ledger, or null when there is no such workspace. */
export async function findAllowance(workspaceId: string): Promise<AiAllowanceView | null> {
  try {
    return await call(AiAllowanceView, `${workspacePath(workspaceId)}/allowance`)
  } catch (e) {
    if (e instanceof ApiFailure && e.status === 404) return null
    throw e
  }
}

export const setAiSettings = (settings: AiSettingsInput) =>
  call(z.null(), '/admin/ai/settings', { method: 'PUT', body: settings })

export const setCurrencyRate = (currency: string, rate: number) =>
  call(z.null(), `/admin/ai/currency-rates/${encodeURIComponent(currency)}`, { method: 'PUT', body: { rate } })

export const setAiPrice = (price: AiPriceInput) => call(z.null(), '/admin/ai/prices', { method: 'PUT', body: price })

export const removeAiPrice = (price: { seller: string; model: string; unit: UsageUnit }) =>
  call(z.null(), `/admin/ai/prices?${new URLSearchParams(price)}`, { method: 'DELETE' })

export const setModelSellers = (model: string, sellers: ModelSellersInput) =>
  call(z.null(), `/admin/ai/model-sellers/${encodeURIComponent(model)}`, { method: 'PUT', body: sellers })

export const setStepModel = (step: string, choice: AiStepModelInput) =>
  call(z.null(), `/admin/ai/step-models/${encodeURIComponent(step)}`, { method: 'PUT', body: choice })

export const giveAiGift = (workspaceId: string, gift: GiftInput) =>
  call(AiGrantView, `${workspacePath(workspaceId)}/gifts`, { method: 'POST', body: gift })

export const uploadAiSellerFile = (upload: SellerFileUpload) =>
  call(SellerFileResult, '/admin/ai/seller-files', { method: 'POST', body: upload })

function workspacePath(workspaceId: string) {
  return `/admin/ai/workspaces/${encodeURIComponent(workspaceId)}`
}
