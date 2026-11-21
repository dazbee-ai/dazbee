// Figma's effects as Dazbee's: drop and inner shadows, and layer and background blurs. What Dazbee
// can't draw, or can't keep hidden, is left out or drawn another way, reported.

import type { z } from 'zod'

import type { Effect } from '@dazbee/schema'

import { bool, colourOf, field, type FigmaNode, list, MAX_LENGTH, num, record, str, within } from './read.ts'
import type { Reporter } from './report.ts'
import { PLAIN_BLENDS } from './settings.ts'

/** An effect as the import writes it, before the schema fills in its defaults. */
export type EffectInput = z.input<typeof Effect>

/**
 * A node's effects as Dazbee's, in the file's order. Figma's `radius` is Dazbee's blur, both twice
 * the Gaussian sigma. A progressive blur is drawn evenly at its end radius, a shrinking inner
 * shadow with no spread, and a shadow in another blend mode normal, each reported. Noise, texture,
 * unknown, unreadable and hidden effects are left out, reported.
 */
export function effectsOf(report: Reporter, n: FigmaNode): EffectInput[] {
  return list(field(n.fields, 'effects')).flatMap((value): EffectInput[] => {
    const e = record(value)
    const type = str(field(e, 'type'))
    if (e && bool(field(e, 'visible')) === false) {
      report.add('hidden-effects', n)
      return []
    }
    const radius = within(num(field(e, 'radius')) ?? 0, 0, MAX_LENGTH)
    switch (type) {
      case 'DROP_SHADOW':
      case 'INNER_SHADOW': {
        const color = colourOf(field(e, 'color'))
        if (!color) break
        if (!PLAIN_BLENDS.has(str(field(e, 'blendMode')) ?? 'NORMAL')) report.add('effect-blend-modes', n)
        const offset = field(e, 'offset')
        const at = { x: shift(num(field(offset, 'x'))), y: shift(num(field(offset, 'y'))), blur: radius }
        const spread = shift(num(field(e, 'spread')))
        if (type === 'DROP_SHADOW') {
          const behind = field(e, 'showShadowBehindNode') === true ? { showBehind: true } : {}
          return [{ type: 'dropShadow', ...at, spread, color, ...behind }]
        }
        if (spread < 0) report.add('inner-shadow-spreads', n)
        return [{ type: 'innerShadow', ...at, spread: Math.max(0, spread), color }]
      }
      case 'LAYER_BLUR':
      case 'BACKGROUND_BLUR':
        if (field(e, 'blurType') === 'PROGRESSIVE') report.add('progressive-blurs', n)
        return [{ type: type === 'LAYER_BLUR' ? 'layerBlur' : 'backgroundBlur', radius }]
      case 'NOISE':
        report.add('noise-effects', n)
        return []
      case 'TEXTURE':
        report.add('texture-effects', n)
        return []
      case undefined:
        break
      default:
        report.add('unknown-effects', n)
        return []
    }
    report.add('unreadable-effects', n)
    return []
  })
}

/** An offset or spread within reach, 0 when there is none. */
function shift(v: number | undefined): number {
  return within(v ?? 0, -MAX_LENGTH, MAX_LENGTH)
}
