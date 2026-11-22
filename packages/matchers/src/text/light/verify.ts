// Verifying Light's finalists: each drawn in the piece's colours and tilt, at the piece's size, and
// judged by the looks-the-same rule; the closest of those that look the same wins, else the closest.
// Closeness is the rule's SSIM less the ink missed, plus a quarter of the fingerprint's vote.

import type { Rgb } from '@dazbee/schema'

import { type Judged, looksSame } from '../../looks-same/rule.ts'
import { hexColour } from '../../shape/parts/colour.ts'
import { isCutOut } from '../ink.ts'
import type { PieceReading } from '../read-piece.ts'
import { type Placed, type TextDrawer, textLayerProps, type TextLook } from './draw-text.ts'
import type { Fitted } from './fit.ts'

/** A finalist drawn in the piece's colours and tilt, and judged. */
export interface Verified extends Judged {
  face: Fitted['face']
  look: TextLook
  /** The text layer in the piece's pixels, tilted as the piece is. */
  place: Placed
}

/** What a finalist is drawn over and judged against. */
export interface VerifyTarget {
  /** The piece read at the size it is verified at. */
  reading: PieceReading
  words: string
  /** The colours the piece is seen on. */
  backgrounds: readonly Rgb[]
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

/** A fit in the piece's fill colour and outline, its place tilted back as the piece is, drawn and judged. */
function finish(drawer: TextDrawer, target: VerifyTarget, fit: Fitted): Verified {
  const { reading } = target
  const look: TextLook = {
    ...fit.look,
    color: hexColour(...reading.fill),
    ...(reading.outline
      ? {
          outline: {
            width: fit.look.outline?.width ?? reading.outline.width,
            color: hexColour(...reading.outline.colour),
          },
        }
      : {}),
  }
  const place = untilt(fit.place, reading)
  return { face: fit.face, look, place, ...judgeText(drawer, target, look, place) }
}

/** The closeness of a rebuild: the rule's SSIM less the share of ink it missed. */
function closeness(scores: Judged['scores']): number {
  return scores.ssim - scores.inkMissed
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
