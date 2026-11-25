// Puts in use the adapter of every seller whose keys the environment sets.
import { metaSeller } from './meta.ts'
import { modalSeller } from './modal.ts'
import { openaiSeller } from './openai.ts'
import { openrouterSeller } from './openrouter.ts'
import { pixazoSeller } from './pixazo.ts'
import { type SellerAdapter, useSeller } from './seller.ts'
import { zenmuxSeller } from './zenmux.ts'

/** Each seller's key settings, all of which it needs, and its adapter on their values. */
const SELLERS: { keys: string[]; adapter: (values: string[]) => SellerAdapter }[] = [
  { keys: ['OPENAI_API_KEY'], adapter: ([apiKey = '']) => openaiSeller(apiKey) },
  { keys: ['MUSE_API_KEY'], adapter: ([apiKey = '']) => metaSeller(apiKey) },
  { keys: ['OPENROUTER_API_KEY'], adapter: ([apiKey = '']) => openrouterSeller(apiKey) },
  { keys: ['ZENMUX_API_KEY'], adapter: ([apiKey = '']) => zenmuxSeller(apiKey) },
  { keys: ['PIXAZO_API_KEY'], adapter: ([apiKey = '']) => pixazoSeller(apiKey) },
  { keys: ['MODAL_TOKEN_ID', 'MODAL_TOKEN_SECRET'], adapter: ([id = '', secret = '']) => modalSeller(id, secret) },
]

/** Puts in use each seller whose keys `env` all sets; the sellers put in use. */
export function useSellersOf(env: NodeJS.ProcessEnv = process.env): string[] {
  const used: string[] = []
  for (const { keys, adapter } of SELLERS) {
    const values = keys.map((key) => env[key] ?? '')
    if (values.some((value) => !value)) continue
    const seller = adapter(values)
    useSeller(seller)
    used.push(seller.seller)
  }
  return used
}
