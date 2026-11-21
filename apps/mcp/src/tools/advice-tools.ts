// The tools that advise an agent before it designs, needing no open design: the fonts a brand may use, and the ad
// rules for a size or channel with the plans. Nothing here changes a design or holds one back.
import { z } from 'zod'

import { FONT_CATEGORIES } from '@dazbee/fonts'
import { type FontFamily, SIZE_CHANNELS, sizeProblem } from '@dazbee/schema'

import { AD_KINDS } from '../ad-kinds.ts'
import { channelRules, sizeRules } from '../ad-rules.ts'
import { PLANS, planText } from '../plans.ts'
import { defineTool, type Tool, ToolRefusal } from './define-tool.ts'
import { BrandId } from './workspace-tools.ts'

/** A family as list_fonts gives it: each style's weights, a variable face's as a range. */
interface ListedFont {
  family: string
  category: string | null
  own?: true
  styles: { normal?: string; italic?: string }
}

/** The plans' names, which ad_rules takes as `plan`. */
const PLAN_NAMES = PLANS.map(({ name }) => name)
/** The most families list_fonts answers. */
const MAX_FONTS = 40
/** A size as an agent writes it: width x height in pixels. */
const SIZE = /^\s*(\d{1,5})\s*[x×X]\s*(\d{1,5})\s*$/

export const ADVICE_TOOLS: Tool[] = [
  defineTool({
    name: 'list_fonts',
    title: 'List fonts',
    description: `Lists the fonts a brand may set text in: its own uploads first, then the font catalog (every Google Fonts family Dazbee offers) by popularity, each with its category and each style’s weights (a variable font’s as a range). \`query\` keeps families whose name holds it; \`category\` keeps one kind of letter and leaves out uploads, which have none. At most ${MAX_FONTS}; \`more\` counts the rest.`,
    readOnly: true,
    input: z.object({
      brand: BrandId,
      query: z
        .string()
        .trim()
        .max(100)
        .optional()
        .describe('A part of a family’s name to look for, at most 100 characters'),
      category: z
        .enum(FONT_CATEGORIES)
        .optional()
        .describe('The kind of letter: sans-serif, serif, display, handwriting or monospace'),
    }),
    run: async ({ brand, query, category }, { api }) => {
      const needle = query?.toLowerCase() ?? ''
      const found = (await api.fonts(brand))
        .filter((family) => family.family.toLowerCase().includes(needle))
        .filter((family) => category === undefined || family.category === category)
        .sort(byOwnThenRank)
      return { families: found.slice(0, MAX_FONTS).map(listed), more: Math.max(0, found.length - MAX_FONTS) }
    },
  }),
  defineTool({
    name: 'ad_rules',
    title: 'Read the ad rules',
    description:
      'Advice for an ad of one size or for one channel’s sizes: the smallest text that reads there and a body and headline size, a margin, the areas each platform’s interface may cover (edges and notches in the frame’s pixels, each with the platform’s own page and the day read), how much to say, font pairings (suiting `kind`, the kind of ad, when given), and what never to invent. `plan` adds a plan’s steps. Advice only: nothing enforces it.',
    readOnly: true,
    input: z.object({
      size: z
        .string()
        .regex(SIZE, 'write a size as width x height in pixels, such as 1080x1920')
        .optional()
        .describe('The frame’s size, width x height in pixels, such as 1080x1920'),
      channel: z.enum(SIZE_CHANNELS).optional().describe('A channel, for the sizes it offers'),
      kind: z.enum(AD_KINDS).optional().describe('The kind of ad, for what to lead with and fonts that suit it'),
      plan: z
        .enum(PLAN_NAMES)
        .optional()
        .describe(`A plan to read the steps of: ${PLAN_NAMES.join(', ')}`),
    }),
    run: async ({ size, channel, kind, plan }) => {
      if (size !== undefined && channel !== undefined) throw new ToolRefusal('Give a size or a channel, not both')
      const steps = PLANS.find(({ name }) => name === plan)
      const planned = steps ? { plan: planText(steps) } : {}
      if (channel !== undefined) return { ...channelRules(channel, kind), ...planned }
      if (size === undefined) {
        if (steps) return planned
        throw new ToolRefusal('Give a size, a channel or a plan')
      }
      const [, width = '', height = ''] = SIZE.exec(size) ?? []
      const problem = sizeProblem(Number(width), Number(height))
      if (problem) throw new ToolRefusal(`\`size\`: ${problem}`)
      return { ...sizeRules(Number(width), Number(height), kind), ...planned }
    },
  }),
]

/** The brand's own uploads first, by name; then the catalog by popularity, then by name. */
function byOwnThenRank(a: FontFamily, b: FontFamily): number {
  const own = Number(b.source === 'upload') - Number(a.source === 'upload')
  if (own !== 0) return own
  const rank = (a.rank ?? Infinity) - (b.rank ?? Infinity)
  return Number.isNaN(rank) || rank === 0 ? a.family.localeCompare(b.family) : rank
}

/** A family as list_fonts gives it. */
function listed(family: FontFamily): ListedFont {
  const weightsOf = (style: 'normal' | 'italic') =>
    family.faces
      .filter((face) => face.style === style)
      .map((face) => (face.weights ? `${face.weights.min}–${face.weights.max}` : `${face.weight}`))
      .join(', ')
  const normal = weightsOf('normal')
  const italic = weightsOf('italic')
  return {
    family: family.family,
    category: family.category,
    ...(family.source === 'upload' ? { own: true as const } : {}),
    styles: { ...(normal ? { normal } : {}), ...(italic ? { italic } : {}) },
  }
}
