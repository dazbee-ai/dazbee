// Verifying Light's finalists: each finished in the piece's colours and tilt, at the piece's size, the
// brand kit's colours and text style taken where they fit, and judged by the looks-the-same rule; the
// closest of those that look the same wins, else the closest. Closeness is the rule's SSIM less the
// ink missed, plus a quarter of the fingerprint's vote.

import type { Bindings, MatchKit, Rgb, TextLook as StyleLook } from '@dazbee/schema'

import { type Judged, looksSame } from '../../looks-same/rule.ts'
import { hexColour } from '../../shape/parts/colour.ts'
import { kitBindings, kitColoured, kitStyle } from '../brand-first.ts'
import { type Placed, type TextDrawer, textLayerProps, type TextLook } from '../draw-text.ts'
import { isCutOut } from '../ink.ts'
import type { PieceReading } from '../read-piece.ts'
import type { Fitted } from './fit.ts'

/** A finalist finished in the piece's colours and tilt, and judged. */
export interface Verified extends Judged {
  /** The finalist as it was fitted, before it was finished. */
  fit: Fitted
  face: Fitted['face']
  look: TextLook
  /** The text layer in the piece's pixels, tilted as the piece is. */
  place: Placed
  /** The text's bindings to the brand kit. */
  bindings: Bindings
  /** The look of the kit text style the text is bound to, which its layer takes. */
  styleLook?: StyleLook
  /** The look in the piece's own colours, when it took kit colours. */
  ownLook?: TextLook
}

/** What a finalist is drawn over and judged against, and the brand kit it is finished with. */
export interface VerifyTarget {
  /** The piece read at the size it is verified at. */
  reading: PieceReading
  words: string
  /** The colours the piece is seen on. */
  backgrounds: readonly Rgb[]
  kit: MatchKit
  /** The pixels of the reading a pixel of the piece. */
  scale: number
}

/** How many of the best-ranked fits are verified. */
export const FINALISTS = 2
/** How much the fingerprint's similarity adds to a finalist's closeness. */
const FINAL_VOTE = 0.25

/**
 * The finalist that wins: of `finalists`, the closest of those that look the same, else the closest,
 * an earlier one on a tie.
 */
export function verify(
  drawer: TextDrawer,
  target: VerifyTarget,
  finalists: readonly Fitted[],
  similarities: ReadonlyMap<string, number>,
): Verified | undefined {
  const verified = finalists.map((fit) => {
    const similarity = similarities.get(fit.face.key)
    const judged = finish(drawer, target, fit)
    return { judged, closeness: closeness(judged.scores) + (similarity === undefined ? 0 : FINAL_VOTE * similarity) }
  })
  const passing = verified.filter((v) => v.judged.same)
  const closest = (list: typeof verified) => [...list].sort((a, b) => b.closeness - a.closeness)[0]?.judged
  return closest(passing.length > 0 ? passing : verified)
}

/**
 * A fit finished: set in a kit text style it matches, coloured as the piece is, its place tilted back
 * as the piece is, drawn and judged. Colours near the kit's take them, unless that makes the text look
 * different where the piece's own colours look the same.
 */
export function finish(drawer: TextDrawer, target: VerifyTarget, fit: Fitted): Verified {
  const { reading, words, kit } = target
  const style = kitStyle(drawer, reading, words, fit, kit, target.scale)
  const set = style?.fit ?? fit
  const own = inPieceColours(set.look, reading)
  const place = untilt(set.place, reading)
  const verified = (look: TextLook, judged: Judged, textColor?: Bindings['textColor']): Verified => ({
    fit,
    face: fit.face,
    look,
    place,
    bindings: kitBindings(fit, style, textColor),
    ...(style ? { styleLook: style.look } : {}),
    ...judged,
  })
  const coloured = kitColoured(own, reading, kit.colors)
  if (coloured) {
    const judged = judgeText(drawer, target, coloured.look, place)
    if (judged.same) return { ...verified(coloured.look, judged, coloured.textColor), ownLook: own }
    const plain = judgeText(drawer, target, own, place)
    return plain.same ? verified(own, plain) : { ...verified(coloured.look, judged, coloured.textColor), ownLook: own }
  }
  return verified(own, judgeText(drawer, target, own, place))
}

/**
 * A look's text drawn at the piece's size with nothing behind it, judged against the piece over its
 * backgrounds; a flat crop is judged by the ink its reading found.
 */
export function judgeText(drawer: TextDrawer, target: VerifyTarget, look: TextLook, place: Placed): Judged {
  const { pixels, ink } = target.reading
  const drawn = drawer.draw(pixels.width, pixels.height, textLayerProps(target.words, look, place))
  return looksSame('text', pixels, drawn, {
    backgrounds: target.backgrounds,
    ...(isCutOut(pixels) ? {} : { pieceInk: ink.data }),
  })
}

/** The closeness of a rebuild: the rule's SSIM less the share of ink it missed. */
export function closeness(scores: Judged['scores']): number {
  return scores.ssim - scores.inkMissed
}

/** A fit's look in the piece's fill colour and outline. */
function inPieceColours(look: TextLook, reading: PieceReading): TextLook {
  return {
    ...look,
    color: hexColour(...reading.fill),
    ...(reading.outline
      ? {
          outline: { width: look.outline?.width ?? reading.outline.width, color: hexColour(...reading.outline.colour) },
        }
      : {}),
  }
}

/** A place in the level piece turned back by the piece's tilt about the piece's centre. */
function untilt(place: Placed, reading: PieceReading): Placed {
  if (Math.abs(reading.angle) < 0.01) return place
  const a = (reading.angle * Math.PI) / 180
  const cx = reading.level.width / 2
  const cy = reading.level.height / 2
  const px = place.x + place.width / 2 - cx
  const py = place.y + place.height / 2 - cy
  const x = Math.cos(a) * px - Math.sin(a) * py + cx
  const y = Math.sin(a) * px + Math.cos(a) * py + cy
  return { ...place, x: x - place.width / 2, y: y - place.height / 2, rotation: reading.angle }
}
