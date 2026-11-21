'use client'

// The fonts a brand can pick from: its uploads, the Google Fonts we copied into our storage, and the
// fonts we ship; each family's category and scripts; and how a family's faces are chosen: the face
// that previews it, the face of a weight and slant, and the weight it is set in.
import { useCallback, useEffect, useState } from 'react'

import { FONT_FACES, type GoogleFamily } from '@dazbee/fonts'
import { faceWeights, type FontFace, FontFamily } from '@dazbee/schema'

import { brandPath } from '@/lib/brand-routes.ts'
import type { Messages } from '@/lib/i18n/index.ts'

/** A family's kind of letter: Google's categories, which the chooser's chips filter by. */
export type FontCategory = GoogleFamily['category']

/** Every category, in the order the chooser's chips show them. */
export const FONT_CATEGORIES: readonly FontCategory[] = ['sans-serif', 'serif', 'display', 'handwriting', 'monospace']

/** The category of each font we ship, which the catalog doesn't carry. */
const SHIPPED_CATEGORIES: Readonly<Record<string, FontCategory>> = {
  'Noto Sans': 'sans-serif',
  'Noto Sans Devanagari': 'sans-serif',
  'Noto Naskh Arabic': 'serif',
}

/** The scripts each font we ship draws, as ISO 15924 codes, which the catalog doesn't carry. */
const SHIPPED_SCRIPTS: Readonly<Record<string, readonly string[]>> = {
  'Noto Sans': ['Latn', 'Cyrl', 'Grek'],
  'Noto Sans Devanagari': ['Deva'],
  'Noto Naskh Arabic': ['Arab'],
}

/** The fonts we ship, as catalog families; they have no stored preview. */
const SHIPPED: FontFamily[] = [...new Set(FONT_FACES.map((f) => f.family))].map((family) => ({
  family,
  source: 'builtin',
  category: null,
  faces: FONT_FACES.filter((f) => f.family === family).map((f) => ({
    id: `builtin-${f.file.replace(/\.\w+$/, '')}`,
    family,
    weight: f.weight,
    style: f.style,
    source: 'builtin',
    byteSize: 1,
  })),
}))

/** The brand's catalog, with the shipped fonts last; `refresh` fetches it again after an upload. */
export function useFontCatalog(workspaceId: string, brandId: string) {
  const [catalog, setCatalog] = useState<FontFamily[]>(SHIPPED)
  const refresh = useCallback(async () => {
    // Offline, the list keeps what it had; it is fetched again each time it opens.
    const response = await fetch(brandPath(workspaceId, brandId, 'fonts')).catch(() => null)
    if (!response?.ok) return
    const families = FontFamily.array().parse(await response.json())
    // A brand's upload of a shipped family's name is the one it sees.
    setCatalog([...families, ...SHIPPED.filter((s) => !families.some((f) => f.family === s.family))])
  }, [workspaceId, brandId])
  useEffect(() => {
    void refresh()
  }, [refresh])
  return { catalog, refresh }
}

/** A family's category: Google's, or the one we give a font we ship; an upload has none. */
export function categoryOf(family: FontFamily): FontCategory | null {
  const known = FONT_CATEGORIES.find((category) => category === family.category)
  if (known) return known
  return family.source === 'builtin' ? (SHIPPED_CATEGORIES[family.family] ?? null) : null
}

/** The scripts a family draws, as ISO 15924 codes: Google's, or those of a font we ship; none for an upload. */
export function scriptsOf(family: FontFamily): readonly string[] {
  if (family.source === 'builtin') return SHIPPED_SCRIPTS[family.family] ?? []
  return family.scripts ?? []
}

/** The face that previews a family: upright and nearest Regular. */
export const previewFace = (family: FontFamily) =>
  [...family.faces].sort((a, b) =>
    a.style === b.style ? Math.abs(a.weight - 400) - Math.abs(b.weight - 400) : a.style === 'normal' ? -1 : 1,
  )[0]

/**
 * The face that draws a family at a weight and slant: one of that slant where the family has one,
 * else upright, nearest the weight, a variable face at any weight of its range. None for a family
 * the catalog doesn't hold.
 */
export const faceFor = (family: FontFamily | undefined, weight: number, style: FontFace['style']) => {
  const faces = family?.faces ?? []
  const slanted = faces.filter((f) => f.style === style)
  const upright = faces.filter((f) => f.style === 'normal')
  const pool = slanted.length > 0 ? slanted : upright.length > 0 ? upright : faces
  const off = (face: FontFace) => Math.min(...faceWeights(face).map((w) => Math.abs(w - weight)))
  return [...pool].sort((a, b) => off(a) - off(b))[0]
}

/** The family's upright weights, or every weight when it has no upright face; a variable face draws its range's. */
export const weightsOf = (family: FontFamily | undefined) => {
  const upright = family?.faces.filter((f) => f.style === 'normal') ?? []
  return [...new Set((upright.length > 0 ? upright : (family?.faces ?? [])).flatMap(faceWeights))].sort((a, b) => a - b)
}

/** A weight's name, such as Bold, from the person's catalog; its number for a weight between the hundreds. */
export const weightName = (names: Messages['editor']['fonts']['weights'], weight: number) =>
  names[weight as keyof typeof names] ?? String(weight)

/** The weight a family is set in: the one it had when the family has it, otherwise the nearest. */
export const nearest = (weights: number[], wanted: number) =>
  weights.reduce((best, w) => (Math.abs(w - wanted) < Math.abs(best - wanted) ? w : best), weights[0] ?? wanted)
