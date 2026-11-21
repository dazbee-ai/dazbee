// PROTOTYPE. Plain names for layers, as a designer would call them: a colour word and a shape word.
import { deltaE00, rgbToLab } from './colour.ts'
import type { Params } from './fit.ts'

const COLOURS: [string, string][] = [
  ['Black', '111111'],
  ['Charcoal', '36393E'],
  ['Grey', '8A8A8A'],
  ['Silver', 'C8C8C8'],
  ['White', 'FFFFFF'],
  ['Cream', 'F6EBD3'],
  ['Beige', 'D9C5A0'],
  ['Tan', 'C19A6B'],
  ['Brown', '6B3E1E'],
  ['Chocolate', '3B2016'],
  ['Red', 'E02424'],
  ['Crimson', 'B0102E'],
  ['Burgundy', '6E1A2E'],
  ['Pink', 'F27BB0'],
  ['Blush', 'F4CFCF'],
  ['Coral', 'F2765A'],
  ['Orange', 'F47B20'],
  ['Peach', 'F9C7A0'],
  ['Gold', 'C9A24A'],
  ['Mustard', 'D8A92A'],
  ['Yellow', 'FBD72B'],
  ['Lime', 'B6E22E'],
  ['Green', '2E9E4F'],
  ['Forest green', '1F4D36'],
  ['Olive', '7A7A3A'],
  ['Mint', 'BDF2DC'],
  ['Teal', '138A8A'],
  ['Cyan', '22C3E6'],
  ['Sky blue', '9CD3F2'],
  ['Blue', '2563EB'],
  ['Navy', '15224A'],
  ['Indigo', '3F2E8C'],
  ['Purple', '7C3AED'],
  ['Lavender', 'C9B8F0'],
  ['Plum', '5E2750'],
  ['Magenta', 'D61F8C'],
  ['Terracotta', 'C2603E'],
]
const LABS = COLOURS.map(([n, h]) => ({
  n,
  lab: rgbToLab(parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)),
}))

export function colourName(rgb: [number, number, number]) {
  const lab = rgbToLab(...rgb)
  let best = LABS[0]!
  let bd = Infinity
  for (const c of LABS) {
    const d = deltaE00(lab, c.lab)
    if (d < bd) {
      bd = d
      best = c
    }
  }
  return best.n
}

export function shapeName(p: Params | null, background: boolean) {
  if (background) return 'background'
  if (!p) return 'shape'
  const ratio = Math.max(p.w, p.h) / Math.max(0.01, Math.min(p.w, p.h))
  const word =
    p.kind === 'line'
      ? 'line'
      : p.kind === 'ellipse'
        ? ratio < 1.06
          ? 'circle'
          : 'oval'
        : p.kind === 'star'
          ? p.n >= 10
            ? 'starburst'
            : 'star'
          : p.kind === 'polygon'
            ? (({ 3: 'triangle', 4: 'diamond', 5: 'pentagon', 6: 'hexagon', 8: 'octagon' } as Record<number, string>)[
                p.n
              ] ?? 'polygon')
            : p.r >= Math.min(p.w, p.h) / 2 - 0.5
              ? ratio < 1.06
                ? 'circle'
                : 'pill'
              : ratio > 2.2 && p.r < 1
                ? 'banner'
                : p.r > 0.5
                  ? 'rounded rectangle'
                  : 'rectangle'
  return p.outline ? `${word} outline` : word
}
