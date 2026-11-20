import type { BrandKit } from './api.ts'

/** A token not yet in the kit, from a name: "Colour 3" gives colour-3. */
export function newToken(kit: BrandKit, name: string) {
  const base =
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'token'
  const taken = new Set([...kit.colors, ...kit.fonts].map((x) => x.token))
  let token = base
  for (let n = 2; taken.has(token); n++) token = `${base}-${n}`
  return token
}
