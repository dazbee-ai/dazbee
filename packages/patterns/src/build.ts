// What a pattern builds a frame with: the tree it adds to, how its words are set, its content, and the parts every
// pattern places alike: the background, the photo and the logo.
import type { Rect } from '@dazbee/schema'

import { contrast, type Swatch } from './palette.ts'
import { fitted, picture, rect, solid, type TreeBuilder } from './tree.ts'
import type { PatternContent, PatternStyle } from './types.ts'
import type { Setting, WordPart } from './words.ts'

/** A frame being built: its tree, how its words are set, its style's name and the content. */
export interface Build extends Setting {
  tree: TreeBuilder
  styleName: PatternStyle
  content: PatternContent
}

/** The contrast under which two colours read as one. */
const SAME_COLOUR = 1.4

/** The background: a rectangle over the whole frame in a colour, bound to its role. */
export function backdrop(b: Build, colour: Swatch): void {
  const { width, height } = b.frame
  b.tree.add('background', { ...rect('Background', { x: 0, y: 0, width, height }, solid(colour)), role: 'background' })
}

/** The photo covering `box`, with its corners rounded by `radius`; nothing without one. */
export function photo(b: Build, box: Rect, radius = 0): boolean {
  if (!b.content.photo) return false
  b.tree.add('photo', { ...picture('Photo', box, b.content.photo, { radius }), role: 'background' })
  return true
}

/**
 * The logo, bound to the Logo role, fitted inside `room` with its shape kept and lined up by `align`; the box it
 * takes, or none without a logo.
 */
export function logo(b: Build, room: Rect, align: 'start' | 'center' | 'end' = 'start', on?: Swatch): Rect | undefined {
  if (!b.content.logo) return undefined
  const box = fitted(b.content.logo, room, { x: align, y: 'center' })
  // A logo is drawn for the kit's background: on another colour it sits on a tab of the background.
  if (on && contrast(on.value, b.palette.background.value) > SAME_COLOUR) {
    const pad = Math.round(box.height * 0.45)
    const tab = { x: box.x - pad, y: box.y - pad, width: box.width + 2 * pad, height: box.height + 2 * pad }
    const radius = Math.round(tab.height * b.style.buttonRound)
    b.tree.add('logo-tab', rect('Logo tab', tab, solid(b.palette.background), { radius }))
  }
  b.tree.add('logo', picture('Logo', box, b.content.logo, { fit: 'fit', logo: true }))
  return box
}

/** The room a logo takes at the top of a frame: a band as tall as the style's logo, across `width`. */
export function logoRoom(b: Build, at: { x: number; y: number }, width: number): Rect {
  const short = Math.min(b.frame.width, b.frame.height)
  const height = Math.round(Math.max(b.frame.readable * 1.6, short * 0.065))
  const ratio = b.content.logo ? b.content.logo.width / b.content.logo.height : 3
  return { x: at.x, y: at.y, width: Math.min(width, Math.round(height * Math.max(ratio, 1))), height }
}

/** The usual words: the kicker, the headline with its highlight, and the subline, as the content gives them. */
export function usualWords(content: PatternContent): WordPart[] {
  return [
    ...(content.kicker ? [{ kind: 'kicker' as const, text: content.kicker }] : []),
    {
      kind: 'headline' as const,
      text: content.headline,
      ...(content.highlight ? { highlight: content.highlight } : {}),
    },
    ...(content.subline ? [{ kind: 'subline' as const, text: content.subline }] : []),
  ]
}
