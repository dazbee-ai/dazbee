// A plain name for each graphic the shape matcher makes, as a designer would call it: a colour word
// and a shape word, such as "Navy pill" or "White circle outline".

import { ciede2000, srgbToLab } from '../looks-same/colour.ts'
import { hexRgb } from './colour.ts'
import type { ShapeFit } from './fit-shapes.ts'

/** The colour words, each with the colour it names. */
const COLOUR_WORDS: readonly (readonly [string, `#${string}`])[] = [
  ['Black', '#111111'],
  ['Charcoal', '#36393E'],
  ['Grey', '#8A8A8A'],
  ['Silver', '#C8C8C8'],
  ['White', '#FFFFFF'],
  ['Cream', '#F6EBD3'],
  ['Beige', '#D9C5A0'],
  ['Tan', '#C19A6B'],
  ['Brown', '#6B3E1E'],
  ['Chocolate', '#3B2016'],
  ['Red', '#E02424'],
  ['Crimson', '#B0102E'],
  ['Burgundy', '#6E1A2E'],
  ['Pink', '#F27BB0'],
  ['Blush', '#F4CFCF'],
  ['Coral', '#F2765A'],
  ['Orange', '#F47B20'],
  ['Peach', '#F9C7A0'],
  ['Gold', '#C9A24A'],
  ['Mustard', '#D8A92A'],
  ['Yellow', '#FBD72B'],
  ['Lime', '#B6E22E'],
  ['Green', '#2E9E4F'],
  ['Forest green', '#1F4D36'],
  ['Olive', '#7A7A3A'],
  ['Mint', '#BDF2DC'],
  ['Teal', '#138A8A'],
  ['Cyan', '#22C3E6'],
  ['Sky blue', '#9CD3F2'],
  ['Blue', '#2563EB'],
  ['Navy', '#15224A'],
  ['Indigo', '#3F2E8C'],
  ['Purple', '#7C3AED'],
  ['Lavender', '#C9B8F0'],
  ['Plum', '#5E2750'],
  ['Magenta', '#D61F8C'],
  ['Terracotta', '#C2603E'],
]
/** A shape is round, a circle rather than an oval, when its sides are within this ratio. */
const ROUND = 1.06

const COLOUR_LABS = COLOUR_WORDS.map(([word, hex]) => ({
  word,
  lab: srgbToLab(...hexRgb(hex)),
}))

/** A graphic's name: its colour's word, then its shape's, or "background" for one that fills the piece. */
export function layerName(rgb: readonly [number, number, number], fit: ShapeFit, background: boolean): string {
  return `${colourWord(rgb)} ${background ? 'background' : shapeWord(fit)}`
}

/** The word of the colour nearest by ΔE00. */
function colourWord(rgb: readonly [number, number, number]): string {
  const lab = srgbToLab(...rgb)
  let best = COLOUR_LABS[0]?.word ?? ''
  let bestDistance = Infinity
  for (const { word, lab: other } of COLOUR_LABS) {
    const d = ciede2000(lab, other)
    if (d < bestDistance) {
      bestDistance = d
      best = word
    }
  }
  return best
}

/** The shape's word: line, circle, oval, pill, banner, rounded rectangle or rectangle, "outline" after it for a ring. */
function shapeWord(fit: ShapeFit): string {
  const ratio = Math.max(fit.width, fit.height) / Math.max(0.01, Math.min(fit.width, fit.height))
  const word =
    fit.kind === 'line'
      ? 'line'
      : fit.kind === 'ellipse'
        ? ratio < ROUND
          ? 'circle'
          : 'oval'
        : fit.radius >= Math.min(fit.width, fit.height) / 2 - 0.5
          ? ratio < ROUND
            ? 'circle'
            : 'pill'
          : ratio > 2.2 && fit.radius < 1
            ? 'banner'
            : fit.radius > 0.5
              ? 'rounded rectangle'
              : 'rectangle'
  return fit.strokeOnly ? `${word} outline` : word
}
