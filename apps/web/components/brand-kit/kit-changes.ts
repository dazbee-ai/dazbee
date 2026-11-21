// The parts of a kit a change touched, for saying which changes a refused save didn't keep.
import type { BrandKit } from '@dazbee/schema'

import { format, type Locale, type Messages } from '@/lib/i18n/index.ts'

/** A part of the kit's form, in the form's order. */
export type KitPart = 'colors' | 'fonts' | 'textStyles' | 'logo' | 'voice'

const PART_VALUES: Record<KitPart, (kit: BrandKit) => unknown> = {
  colors: (kit) => kit.colors,
  fonts: (kit) => kit.fonts,
  textStyles: (kit) => kit.textStyles,
  logo: (kit) => kit.logoAssetId,
  voice: (kit) => kit.voice,
}

/** The parts of `changed` that differ from `from`, in the form's order. */
export function changedParts(from: BrandKit, changed: BrandKit): KitPart[] {
  return (Object.keys(PART_VALUES) as KitPart[]).filter(
    (part) => canonical(PART_VALUES[part](from)) !== canonical(PART_VALUES[part](changed)),
  )
}

/** What a refused save tells the person: that the kit changed, and the parts whose changes weren't saved. */
export function refusedWords(t: Messages, locale: Locale, unsaved: KitPart[]) {
  const k = t.editor.brandKit
  return unsaved.length > 0
    ? format(k.changedElsewhereUnsaved, { parts: partNames(t, locale, unsaved) })
    : k.changedElsewhere
}

/** The parts' names as the form heads them, as one list: "Colours and Logo". */
export function partNames(t: Messages, locale: Locale, parts: KitPart[]) {
  const k = t.editor.brandKit
  const names: Record<KitPart, string> = {
    colors: k.colors,
    fonts: k.fonts,
    textStyles: k.textStyles,
    logo: k.logo,
    voice: k.voice,
  }
  return new Intl.ListFormat(locale, { type: 'conjunction' }).format(parts.map((part) => names[part]))
}

/** A value as JSON with each object's keys sorted, so the same value reads the same however it was built. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  )
}
