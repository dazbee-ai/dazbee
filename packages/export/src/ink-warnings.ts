// The agent warnings read from where a text or a logo puts ink in its frame: cut off at the frame's
// edge, or on another text's or logo's ink.
import { intersects } from '@dazbee/doc'
import type { SceneLayer } from '@dazbee/renderer'
import { brandRef, type Layer, LOGO_ROLE, type Rect } from '@dazbee/schema'

import { type Ink, inkOf, inkWhere, sharedInk, type Turn } from './layer-ink.ts'
import type { Check } from './types.ts'

/** A text or a logo, which another's ink may not overlap and the frame's edge may not cut. */
export interface Marked {
  layer: SceneLayer
  turns: readonly Turn[]
  /** Everything it draws, in the frame's pixels. */
  reach: Rect
  asked: boolean
  logo: boolean
  ink?: Ink
}

/**
 * The least ink, in the frame's square pixels, past the frame's edge that cuts a layer off, and that
 * two layers share to overlap: two pixels, so a letter shaved or touched shows, and an edge pixel
 * anti-aliasing half covers doesn't.
 */
const CUT_AREA = 2
const OVERLAP_AREA = 2

/** Whether a layer is the logo: it has the logo's role, or draws the brand's logo. */
export function isLogo(node: Layer | undefined): boolean {
  return node?.role === 'logo' || node?.bindings?.image === brandRef(LOGO_ROLE)
}

/** Tells of a text or logo whose ink the frame's edge cuts. */
export function cutOffWarning(check: Check, mark: Marked) {
  const { width, height, name } = check.frame
  const past = inkWhere(inkFor(check, mark), (x, y) => x < 0 || y < 0 || x > width || y > height)
  if (past >= CUT_AREA)
    check.warn(mark.layer.id, 'cutOff', `${titled(check, mark)} is cut off at the edge of its frame "${name}".`)
}

/**
 * Tells of each text or logo below `mark` whose ink `mark`'s overlaps, on `mark` when it was asked
 * for, else on the one below. Two logos are not compared.
 */
export function overlapWarnings(check: Check, mark: Marked, below: readonly Marked[]) {
  for (const under of below) {
    if (!(mark.asked || under.asked) || (mark.logo && under.logo)) continue
    if (!intersects(mark.reach, under.reach)) continue
    if (sharedInk(inkFor(check, mark), inkFor(check, under)) < OVERLAP_AREA) continue
    const [told, other] = mark.asked ? [mark, under] : [under, mark]
    const named = other.logo ? `the logo "${check.nameOf(other.layer.id)}"` : `text "${check.nameOf(other.layer.id)}"`
    check.warn(told.layer.id, 'overlap', `${titled(check, told)} overlaps ${named}.`)
  }
}

/** A text's or logo's ink, drawn the first time it is asked for. */
function inkFor({ ck, resources }: Check, mark: Marked): Ink {
  mark.ink ??= inkOf(ck, mark.layer, mark.turns, resources, mark.reach)
  return mark.ink
}

/** `Text "name"` or `Logo "name"`. */
function titled({ nameOf }: Check, mark: Marked): string {
  return `${mark.logo ? 'Logo' : 'Text'} "${nameOf(mark.layer.id)}"`
}
