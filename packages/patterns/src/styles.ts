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
  /** How the words line up. */
  align: 'start' | 'center'
  /** A button's corners, as a share of its height: 0 square, 0.5 a pill. */
  buttonRound: number
  /** A panel's or a photo's corners, as a share of the frame's shorter side. */
  round: number
  /** How words of the headline are set apart: in another colour, or in italic. */
  highlight: 'colour' | 'italic'
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
    gap: 0.22,
    align: 'start',
    buttonRound: 0.12,
    round: 0,
    highlight: 'colour',
    colours: { primary: '#FF4A1C', secondary: '#15161B', accent: '#FFD23F', background: '#FFFFFF', text: '#15161B' },
  },
  minimal: {
    fonts: { heading: 'Outfit', body: 'Outfit' },
    headline: look('heading', 500, 600, 'none', -2, 1.08),
    kicker: look('body', 500, 500, 'upper', 14, 1.2),
    body: look('body', 300, 400, 'none', 0, 1.35),
    button: look('body', 500, 500, 'none', 1, 1.2),
    margin: 0.09,
    headlineMax: 0.1,
    gap: 0.35,
    align: 'start',
    buttonRound: 0,
    round: 0,
    highlight: 'colour',
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
    gap: 0.28,
    align: 'center',
    buttonRound: 0.5,
    round: 0.06,
    highlight: 'colour',
    colours: { primary: '#5B3FE0', secondary: '#FFB3D1', accent: '#FFC83D', background: '#FFF4E4', text: '#221A3D' },
  },
  premium: {
    fonts: { heading: 'DM Serif Display', body: 'Jost' },
    headline: look('heading', 400, 600, 'none', -1, 1.06),
    kicker: look('body', 500, 500, 'upper', 24, 1.2),
    body: look('body', 400, 400, 'none', 2, 1.4),
    button: look('body', 500, 500, 'upper', 14, 1.2),
    margin: 0.1,
    headlineMax: 0.12,
    gap: 0.4,
    align: 'center',
    buttonRound: 0,
    round: 0,
    highlight: 'italic',
    colours: { primary: '#101B2E', secondary: '#1B1914', accent: '#C9A45C', background: '#F5EFE4', text: '#16140F' },
  },
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
