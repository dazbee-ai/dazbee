// A Figma layer's own settings as Dazbee's: whether it shows, its opacity, its lock, its blend
// mode, its mask and its constraints. What Dazbee draws another way is reported.

import type { BlendMode, Constraints, ContainerBlendMode, LayerLock } from '@dazbee/schema'

import type { LayerInput } from './build.ts'
import { bool, field, type FigmaNode, list, num, record, str } from './read.ts'
import type { Reporter } from './report.ts'

/** What a layer shows of itself: its opacity and blend mode, each left out at Dazbee's default. */
export interface Look {
  opacity?: number
  blendMode?: ContainerBlendMode
}

/** Figma's blend modes that Dazbee has, by name. */
const BLENDS: ReadonlyMap<string, BlendMode> = new Map([
  ['NORMAL', 'normal'],
  ['DARKEN', 'darken'],
  ['MULTIPLY', 'multiply'],
  ['COLOR_BURN', 'color-burn'],
  ['LIGHTEN', 'lighten'],
  ['SCREEN', 'screen'],
  ['COLOR_DODGE', 'color-dodge'],
  ['OVERLAY', 'overlay'],
  ['SOFT_LIGHT', 'soft-light'],
  ['HARD_LIGHT', 'hard-light'],
  ['DIFFERENCE', 'difference'],
  ['EXCLUSION', 'exclusion'],
  ['HUE', 'hue'],
  ['SATURATION', 'saturation'],
  ['COLOR', 'color'],
  ['LUMINOSITY', 'luminosity'],
])
/** Figma's blend modes Dazbee has none of, drawn normal. */
const LINEAR_BLENDS: ReadonlySet<string> = new Set(['LINEAR_BURN', 'LINEAR_DODGE'])
/** Layer types that hold layers and can pass their blending through to them. */
const CONTAINERS: ReadonlySet<string> = new Set(['box', 'group'])
const HORIZONTAL: ReadonlyMap<string, Constraints['horizontal']> = new Map([
  ['LEFT', 'left'],
  ['RIGHT', 'right'],
  ['LEFT_RIGHT', 'leftRight'],
  ['CENTER', 'center'],
  ['SCALE', 'scale'],
])
const VERTICAL: ReadonlyMap<string, Constraints['vertical']> = new Map([
  ['TOP', 'top'],
  ['BOTTOM', 'bottom'],
  ['TOP_BOTTOM', 'topBottom'],
  ['CENTER', 'center'],
  ['SCALE', 'scale'],
])
const LOCKED: LayerLock = { move: true, resize: true, content: true, style: true, delete: true }

/** A layer of `type`'s settings from its node: whether it shows, its look, and its lock, which locks all five. */
export function settingsOf(
  report: Reporter,
  n: FigmaNode,
  type: LayerInput['type'],
): { props: Look & { visible?: false }; lock?: LayerLock } {
  const visible = bool(field(n.fields, 'visible')) === false ? { visible: false as const } : {}
  const lock = bool(field(n.fields, 'locked')) === true ? { lock: LOCKED } : {}
  return { props: { ...visible, ...lookOf(report, n, type) }, ...lock }
}

/**
 * A layer of `type`'s opacity and blend mode. Blend modes map by name: pass-through is a
 * container's own and a graphic's normal, and linear burn and linear dodge are drawn normal, reported.
 */
export function lookOf(report: Reporter, n: FigmaNode, type: LayerInput['type']): Look {
  const opacity = Math.min(1, Math.max(0, num(field(n.fields, 'opacity')) ?? 1))
  const name = str(field(n.fields, 'blendMode')) ?? ''
  if (LINEAR_BLENDS.has(name)) report.add('linear-blend-modes', n)
  const blendMode: ContainerBlendMode | undefined =
    name === 'PASS_THROUGH'
      ? CONTAINERS.has(type)
        ? 'pass-through'
        : 'normal'
      : LINEAR_BLENDS.has(name)
        ? 'normal'
        : BLENDS.get(name)
  return { ...(opacity < 1 ? { opacity } : {}), ...(blendMode ? { blendMode } : {}) }
}

/**
 * A node's mask, when it masks the layers in front of it: alpha for Figma's alpha and vector masks,
 * luminance for its luminance masks. A vector mask masks by its outline alone, so one with a blur, a
 * gradient or a see-through paint, which an alpha mask draws soft, is reported.
 */
export function maskOf(report: Reporter, n: FigmaNode): { mask?: 'alpha' | 'luminance' } {
  if (field(n.fields, 'isMask') !== true) return {}
  const type = field(n.fields, 'maskType')
  if (type === 'LUMINANCE') return { mask: 'luminance' }
  if (type === 'VECTOR' && isSoft(n)) report.add('vector-masks', n)
  return { mask: 'alpha' }
}

/** A node's constraints by name, or undefined when they are Dazbee's default, left and top. */
export function constraintsOf(n: FigmaNode): Constraints | undefined {
  const c = field(n.fields, 'constraints')
  const horizontal = HORIZONTAL.get(str(field(c, 'horizontal')) ?? '') ?? 'left'
  const vertical = VERTICAL.get(str(field(c, 'vertical')) ?? '') ?? 'top'
  return horizontal === 'left' && vertical === 'top' ? undefined : { horizontal, vertical }
}

/** Whether a node draws soft or see-through edges: a blur, a gradient, or a paint or opacity under 1. */
function isSoft(n: FigmaNode): boolean {
  const shows = (v: unknown) => record(v) !== undefined && bool(field(v, 'visible')) !== false
  const blurred = list(field(n.fields, 'effects')).some((e) => shows(e) && field(e, 'type') === 'LAYER_BLUR')
  const soft = list(field(n.fields, 'fills')).some(
    (p) =>
      shows(p) &&
      ((str(field(p, 'type')) ?? '').startsWith('GRADIENT_') ||
        (num(field(p, 'opacity')) ?? 1) < 1 ||
        (num(field(field(p, 'color'), 'a')) ?? 1) < 1),
  )
  return blurred || soft || (num(field(n.fields, 'opacity')) ?? 1) < 1
}
