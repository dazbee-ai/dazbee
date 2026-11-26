// The round plan: four ads planned from a brief, the brand's facts and its pictures.
import {
  answerSchema,
  type BrandFacts,
  type CallInput,
  MAX_REFERENCES,
  type RoundInput,
  RoundPlanAnswer,
} from '@dazbee/schema'

import { shapeOf } from '../call-size.ts'
import { REFERENCE_AD, REFERENCE_KIND, REFERENCE_KIND_UNKNOWN } from '../prompts/ads/reference.ts'
import { LIKED_DRAFT, ROUND_DIRECTOR } from '../prompts/ads/round-director.ts'
import { ROUND_DIRECTOR_LIGHT } from '../prompts/ads/round-director-light.ts'
import { briefPictures } from './draft.ts'
import type { AiFunctionDef } from './types.ts'

export const roundPlan: AiFunctionDef = {
  kind: 'text',
  answer: RoundPlanAnswer,
  // The planners reason before they write four long prompts, past the 60 s a text call usually gets.
  timeoutMs: 240_000,
  presets: {
    // 7.5–10.0 s over four rounds of real briefs; 6,000 tokens in and 3,000 out at OpenAI's fast-tier prices.
    'light-luna': {
      model: 'gpt-6-luna',
      settings: { effort: 'low', tier: 'fast' },
      prompt: ROUND_DIRECTOR_LIGHT,
      ceiling: 12_000,
      guess: { cost: 480_000n, seconds: 10 },
    },
    // 28.4–32.9 s over four rounds of real briefs; 12,000 tokens in and 6,000 out at OpenAI's prices.
    'full-terra': {
      model: 'gpt-6.1-terra',
      settings: { effort: 'low', tier: 'standard' },
      prompt: ROUND_DIRECTOR,
      ceiling: 24_000,
      guess: { cost: 4_780_000n, seconds: 33 },
    },
  },
}

/** What the planner sees first: a reference ad with the kind read from it, or the draft the person liked. */
export type Lead = { kind: 'reference'; key: string; adKind: string | null } | { kind: 'liked'; key: string }

/**
 * The round plan's call: its preset's director as instructions, and a message with the brief's words, the canvas,
 * the brand's facts and what each attached picture is, then the reference or liked-draft words. The lead picture
 * comes first, then the brief's pictures and the kit logo.
 */
export function planCall(input: RoundInput, lead: Lead | null, director: string): CallInput {
  const own = briefPictures(input)
  const pictures = [...(lead ? [lead.key] : []), ...own].slice(0, MAX_REFERENCES)
  const parts = [
    `What the advertiser asks for:\n${input.words}`,
    `The canvas: ${shapeOf(input.size)}, ${input.size.width} × ${input.size.height} px.`,
    brandFacts(input.brand),
    picturesNote(lead, input.pictures.length, Boolean(input.logoKey)),
    lead ? leadWords(lead) : '',
  ]
  return {
    kind: 'text',
    instructions: director,
    prompt: parts.filter(Boolean).join('\n\n'),
    pictures,
    schema: answerSchema(RoundPlanAnswer),
  }
}

/** The brand kit's picks as the planner is told them; nothing when the kit has none. */
function brandFacts(brand: BrandFacts): string {
  const lines = [
    brand.name && `- Name: ${brand.name}`,
    brand.colors.length > 0 && `- Colours: ${brand.colors.join(', ')}`,
    brand.fonts.length > 0 && `- Fonts: ${brand.fonts.join(', ')}`,
    brand.voice && `- Voice: ${brand.voice}`,
  ].filter(Boolean)
  return lines.length > 0 ? `The brand's facts:\n${lines.join('\n')}` : ''
}

/** What each attached picture is, in order; nothing when there are none. */
function picturesNote(lead: Lead | null, own: number, logo: boolean): string {
  const which = [
    lead?.kind === 'reference' && 'the reference ad',
    lead?.kind === 'liked' && 'the draft the advertiser liked',
    own === 1 && "the advertiser's own picture",
    own > 1 && `${own} of the advertiser's own pictures`,
    logo && "the brand's logo",
  ].filter(Boolean)
  return which.length > 0 ? `The attached pictures, in order: ${which.join(', then ')}.` : ''
}

/** The words the planner is told for its lead picture. */
function leadWords(lead: Lead): string {
  if (lead.kind === 'liked') return LIKED_DRAFT
  const kind = lead.adKind ? REFERENCE_KIND.replace('{kind}', () => lead.adKind ?? '') : REFERENCE_KIND_UNKNOWN
  return REFERENCE_AD.replace('{kind}', () => kind)
}
