// Puts in use the adapter of every seller whose key the environment sets.
import { metaSeller } from './meta.ts'
import { openaiSeller } from './openai.ts'
import { openrouterSeller } from './openrouter.ts'
import { pixazoSeller } from './pixazo.ts'
import { type SellerAdapter, useSeller } from './seller.ts'
import { zenmuxSeller } from './zenmux.ts'

/** Each seller's key setting and its adapter. */
const SELLERS: { key: string; adapter: (apiKey: string) => SellerAdapter }[] = [
  { key: 'OPENAI_API_KEY', adapter: openaiSeller },
  { key: 'MUSE_API_KEY', adapter: metaSeller },
  { key: 'OPENROUTER_API_KEY', adapter: openrouterSeller },
  { key: 'ZENMUX_API_KEY', adapter: zenmuxSeller },
  { key: 'PIXAZO_API_KEY', adapter: (apiKey) => pixazoSeller(apiKey) },
]

/** Puts in use each seller whose key `env` sets; the sellers put in use. */
export function useSellersOf(env: NodeJS.ProcessEnv = process.env): string[] {
  const used: string[] = []
  for (const { key, adapter } of SELLERS) {
    const apiKey = env[key]
    if (!apiKey) continue
    const seller = adapter(apiKey)
    useSeller(seller)
    used.push(seller.seller)
  }
  return used
}
