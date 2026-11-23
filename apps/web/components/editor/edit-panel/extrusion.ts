// The Effects panel's 3D, read and written: the extrusion the selected texts share, and the patch
// a pick of 3D, a depth, an angle or a side colour writes to each text.
import { shadedColour } from '@dazbee/renderer'
import type { TextExtrusion } from '@dazbee/schema'

import { clamp } from '@/components/editor/edit-panel/number-field.tsx'
import { type Patch, type Props, shared, type Style } from '@/components/editor/edit-panel/target.ts'
import { tidy } from '@/lib/editor/size.ts'

/** How the sides are coloured: a darker shade of the letters' own paint, or a colour chosen. */
export type SideColour = 'shade' | 'colour'

/** The extrusion as the panel shows it, each value the one the texts share, or mixed. */
export interface SharedExtrusion {
  depth: number | 'mixed'
  angle: number | 'mixed'
  sides: SideColour | 'mixed'
  /** The side colour the texts share, mixed, or none unless every one has a chosen colour. */
  color: string | 'mixed' | undefined
}

/** The side colour choices, in the order they show. */
export const SIDE_COLOURS = ['shade', 'colour'] as const satisfies readonly SideColour[]

/** What 3D picked on a text with none starts at: a depth of 15 % of its font size, down and right, in the shade. */
export const EXTRUSION_START: TextExtrusion = { depth: 15, angle: 45 }

/** The extrusion every one of the texts shares, field by field; null unless every one has one. */
export function sharedExtrusion(props: readonly Props[]): SharedExtrusion | null {
  const all = props.map(extrusionOf)
  const extrusions = all.filter((extrusion) => extrusion !== undefined)
  if (extrusions.length === 0 || extrusions.length < all.length) return null
  const sides = shared(extrusions.map(sidesOf))
  return {
    depth: shared(extrusions.map((extrusion) => extrusion.depth)),
    angle: shared(extrusions.map((extrusion) => extrusion.angle)),
    sides,
    color: sides === 'colour' ? shared(extrusions.map((extrusion) => extrusion.color)) : undefined,
  }
}

/**
 * The patch that turns a text's 3D on, keeping an extrusion it has or starting it at
 * EXTRUSION_START, or off, taking its extrusion off. Null where nothing changes.
 */
export function pickExtrusion(now: Props, on: boolean): Patch | null {
  const was = extrusionOf(now)
  if (on) return was ? null : { extrusion: EXTRUSION_START }
  return was ? { extrusion: undefined } : null
}

/** The patch that changes a text's depth from its own, held between 0 and 100; null for a text with no extrusion. */
export function depthPatch(now: Props, change: (depth: number) => number): Patch | null {
  return changed(now, (was) => ({ ...was, depth: tidy(clamp(change(was.depth), 0, 100)) }))
}

/** The patch that changes a text's angle from its own, wrapping round at 360; null for a text with no extrusion. */
export function anglePatch(now: Props, change: (angle: number) => number): Patch | null {
  return changed(now, (was) => ({ ...was, angle: tidy(((change(was.angle) % 360) + 360) % 360) }))
}

/**
 * The patch that colours a text's sides in a shade, leaving its colour out, or in a colour, keeping
 * one it has or starting at the shade its sides show now, so the pick alone changes nothing drawn.
 */
export function sidesPatch(now: Props, to: SideColour): Patch | null {
  return changed(now, ({ color, ...was }) => {
    if (to === 'shade') return was
    return { ...was, color: color ?? shadedColour((now.style as Style).color) }
  })
}

/** The patch that sets a text's side colour, built from the one it has; null for a text with no extrusion. */
export function sideColourPatch(now: Props, to: (color: string | undefined) => string): Patch | null {
  return changed(now, (was) => ({ ...was, color: to(was.color) }))
}

function extrusionOf(props: Props): TextExtrusion | undefined {
  return props.extrusion as TextExtrusion | undefined
}

function sidesOf(extrusion: TextExtrusion): SideColour {
  return extrusion.color === undefined ? 'shade' : 'colour'
}

/** The patch that gives a text's extrusion the one `to` makes of it; null where it has none or nothing changes. */
function changed(now: Props, to: (was: TextExtrusion) => TextExtrusion): Patch | null {
  const was = extrusionOf(now)
  if (!was) return null
  const next = to(was)
  return JSON.stringify(next) === JSON.stringify(was) ? null : { extrusion: next }
}
