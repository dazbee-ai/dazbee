// The four styles a pattern is drawn in. Each sets the type (the fonts it pairs where the brand kit sets none, their
// weights, case and spacing), the room around and between things, the corners and the colours it falls back on where
// the kit sets none; the decoration each style adds is the pattern's own.
import type { BrandRole } from '@dazbee/schema'

import type { PatternStyle } from './types.ts'

/** How a kind of text is set in a style. */
export interface TextLook {
  /** The kit font it follows. */
  font: 'heading' | 'body'
  /** Its weight in the style's own font, and in a brand's font, which may lack the style's. */
  weight: number
  brandWeight: number
  textCase: 'none' | 'upper'
  /** Letter spacing, as a percentage of the size. */
  tracking: number
  /** Line height, as a multiple of the size. */
  lineHeight: number
}

/**
 * Where a style finds the colours a pattern draws with: the ground the words sit on (a brand role, or `deep`, the
 * kit's deepest colour, see `deepColour`) and the role it fills the button with first.
 */
export interface StyleRoles {
  ground: 'primary' | 'background' | 'deep'
  cta: 'accent' | 'primary'
}

/** A style: its fonts, how each kind of text is set, its room, corners and fallback colours. */
export interface Style {
  /** The Google Fonts families it pairs where the kit sets no Heading or Body. */
  fonts: { heading: string; body: string }
  headline: TextLook
  kicker: TextLook
  body: TextLook
  button: TextLook
  /** The room round the frame's edge, as a share of its shorter side. */
  margin: number
  /** How large the headline may be, as a share of the shorter side of the room it has. */
  headlineMax: number
  /** The room between the texts, as a share of the headline's size. */
  gap: number
  /** How many times the readable size the lead is at least over a subline, in a large frame: the style's contrast of scale. */
  scale: number
  /** The face a badge's offer is set in: the heading font where it is heavy, else the body font, bold. */
  badge: { font: 'heading' | 'body'; weight: number }
  /** How the words line up. */
  align: 'start' | 'center'
  /** A button's corners, as a share of its height: 0 square, 0.5 a pill. */
  buttonRound: number
  /** A panel's or a photo's corners, as a share of the frame's shorter side. */
  round: number
  /** How words of the headline are set apart first: in another colour, or in italic. */
  highlight: 'colour' | 'italic'
  /**
   * How the style's own heading font sets words apart where no colour reads: in its italic face, at a heavier
   * weight it has, or underlined. A brand's font, whose faces aren't known, underlines them.
   */
  emphasis: { by: 'italic' | 'weight' | 'underline'; weight?: number }
  /** The colours its patterns draw with, and the ones a pattern draws with in its own way, by pattern id. */
  roles: StyleRoles
  variants: Readonly<Record<string, Partial<StyleRoles>>>
  /** The colours it falls back on where the kit sets none, as #RRGGBB. */
  colours: Record<Exclude<BrandRole, 'heading' | 'body'>, string>
}

export const STYLES: Readonly<Record<PatternStyle, Style>> = {
  bold: {
    fonts: { heading: 'Anton', body: 'Outfit' },
    headline: look('heading', 400, 800, 'upper', 0, 1),
    kicker: look('body', 700, 700, 'upper', 8, 1.15),
    body: look('body', 500, 500, 'none', 0, 1.25),
    button: look('body', 700, 700, 'upper', 6, 1.15),
    margin: 0.065,
    headlineMax: 0.2,
    badge: { font: 'heading', weight: 400 },
    gap: 0.22,
    scale: 2,
    align: 'start',
    buttonRound: 0.12,
    round: 0,
    highlight: 'colour',
    emphasis: { by: 'underline' },
    roles: { ground: 'primary', cta: 'accent' },
    // A split's panel is dark against its photo.
    variants: { split: { ground: 'deep' } },
    colours: { primary: '#FF4A1C', secondary: '#15161B', accent: '#FFD23F', background: '#FFFFFF', text: '#15161B' },
  },
  minimal: {
    fonts: { heading: 'Outfit', body: 'Outfit' },
    headline: look('heading', 500, 600, 'none', -2, 1.08),
    kicker: look('body', 500, 500, 'upper', 14, 1.2),
    body: look('body', 300, 400, 'none', 0, 1.35),
    button: look('body', 500, 500, 'none', 1, 1.2),
    margin: 0.09,
    headlineMax: 0.14,
    badge: { font: 'body', weight: 800 },
    gap: 0.35,
    scale: 2.5,
    align: 'start',
    buttonRound: 0,
    round: 0,
    highlight: 'colour',
    emphasis: { by: 'weight', weight: 800 },
    roles: { ground: 'background', cta: 'primary' },
    variants: {},
    colours: { primary: '#1F2A44', secondary: '#E9E4DA', accent: '#B5502F', background: '#FAF8F4', text: '#1C1C1E' },
  },
  playful: {
    fonts: { heading: 'Fredoka', body: 'Fredoka' },
    headline: look('heading', 600, 800, 'none', -1, 1.02),
    kicker: look('body', 600, 700, 'none', 2, 1.15),
    body: look('body', 400, 400, 'none', 0, 1.25),
    button: look('body', 600, 700, 'none', 1, 1.15),
    margin: 0.075,
    headlineMax: 0.15,
    badge: { font: 'heading', weight: 700 },
    gap: 0.28,
    scale: 2,
    align: 'center',
    buttonRound: 0.5,
    round: 0.06,
    highlight: 'colour',
    emphasis: { by: 'weight', weight: 700 },
    roles: { ground: 'primary', cta: 'accent' },
    // A quote and a product sit calm on the background, so the person's photo and the product lead.
    variants: { quote: { ground: 'background' }, 'product-badge': { ground: 'background' } },
    colours: { primary: '#5B3FE0', secondary: '#FFB3D1', accent: '#FFC83D', background: '#FFF4E4', text: '#221A3D' },
  },
  premium: {
    fonts: { heading: 'DM Serif Display', body: 'Jost' },
    headline: look('heading', 400, 600, 'none', -1, 1.06),
    kicker: look('body', 500, 500, 'upper', 24, 1.2),
    body: look('body', 400, 400, 'none', 2, 1.4),
    button: look('body', 500, 500, 'upper', 12, 1.2),
    margin: 0.1,
    headlineMax: 0.12,
    badge: { font: 'body', weight: 700 },
    gap: 0.4,
    scale: 2.5,
    align: 'center',
    buttonRound: 0,
    round: 0,
    highlight: 'italic',
    emphasis: { by: 'italic' },
    roles: { ground: 'deep', cta: 'accent' },
    variants: {},
    colours: { primary: '#101B2E', secondary: '#1B1914', accent: '#C9A45C', background: '#F5EFE4', text: '#16140F' },
  },
}

/** A style's roles for a pattern: its own, with the pattern's variant over them. */
export function rolesFor(style: Style, pattern: string): StyleRoles {
  return { ...style.roles, ...style.variants[pattern] }
}

/** The styles, in the order they are offered. */
export const PATTERN_STYLES = ['bold', 'minimal', 'playful', 'premium'] as const satisfies readonly PatternStyle[]

/** A kind of text's look. */
function look(
  font: TextLook['font'],
  weight: number,
  brandWeight: number,
  textCase: TextLook['textCase'],
  tracking: number,
  lineHeight: number,
): TextLook {
  return { font, weight, brandWeight, textCase, tracking, lineHeight }
}
