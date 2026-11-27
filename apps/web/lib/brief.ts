// The brand home's brief: the sizes it offers, the brief its form sends, the name of the design it opens, what it
// says of a round that didn't start, and the blank design a size starts.
import {
  type AiMode,
  blankDesign,
  type DesignInput,
  MAX_REFERENCES,
  SIZE_PRESETS,
  type SizePreset,
  type StartRound,
} from '@dazbee/schema'

import type { Messages } from '@/lib/i18n/index.ts'

/** The sizes offered on the brief, the everyday ones; the editor adds any other. */
export const BRIEF_SIZES = ['feed-square', 'feed-portrait', 'story', 'link-image'] as const

export type BriefSize = (typeof BRIEF_SIZES)[number]

/** The longest name a brief gives its design, its first line cut short with "…". */
const NAME_LENGTH = 60

/**
 * A blank design in the sizes a brief picked: one page holding an empty, white frame per size, in
 * the presets' order, each placed by the frame rule so they stand in a row. With no size it knows,
 * one frame of the first brief size.
 */
export function briefDesign(name: string, sizeIds: string[], sizeName: (id: SizePreset['id']) => string): DesignInput {
  const picked = SIZE_PRESETS.filter((p) => sizeIds.includes(p.id))
  const presets = picked.length > 0 ? picked : SIZE_PRESETS.filter((p) => p.id === BRIEF_SIZES[0])
  return blankDesign(
    { designId: 'replaced-by-the-api', name },
    presets.map((preset) => ({ name: sizeName(preset.id), width: preset.width, height: preset.height })),
  )
}

/** The brief a brand home's form sends: its words, pictures, reference design, one size and a speed. */
export function briefFromForm(form: FormData): Pick<StartRound, 'words' | 'pictures' | 'size' | 'mode' | 'reference'> {
  const preset =
    SIZE_PRESETS.find((p) => p.id === form.get('size') && (BRIEF_SIZES as readonly string[]).includes(p.id)) ??
    SIZE_PRESETS.find((p) => p.id === BRIEF_SIZES[0])
  const reference = String(form.get('reference') ?? '')
  const mode: AiMode = form.get('mode') === 'precise' ? 'precise' : 'fast'
  return {
    words: String(form.get('brief') ?? '').trim(),
    pictures: form.getAll('image').map(String).slice(0, MAX_REFERENCES),
    size: { width: preset?.width ?? 1080, height: preset?.height ?? 1080 },
    mode,
    ...(reference ? { reference: { designId: reference } } : {}),
  }
}

/** The name of a brief's design: its first line, cut to 60 characters with "…"; empty for no words. */
export function designName(words: string): string {
  const line = words.split('\n')[0]?.trim() ?? ''
  return line.length > NAME_LENGTH ? `${line.slice(0, NAME_LENGTH - 1).trimEnd()}…` : line
}

/** What the brand home says of a round that didn't start, by the key it was sent back with; null for none it knows. */
export function refusedWords(key: string | undefined, t: Messages): string | null {
  const said = ['usedUp', 'paused', 'notAllowed', 'notStarted'] as const
  const known = said.find((s) => s === key)
  return known ? t.editor.brief[known] : null
}
