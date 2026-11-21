// How a pattern reads a frame's size: the shape it arranges itself for, the room round the edge, and the part of a
// 9:16 frame that every platform's interface leaves clear, where it puts its words, logo and button.
import { isNineBySixteen, readableTextSize, type Rect, SAFE_ZONES } from '@dazbee/schema'

/**
 * The shapes a pattern arranges itself for, by width over height: a strip (728 × 90, 320 × 50), a banner (970 × 250,
 * 320 × 100), wide (1280 × 720), square (1080 × 1080, 1080 × 1350, 300 × 250), tall (1080 × 1920, 300 × 600) and a
 * tower (160 × 600).
 */
export type FrameShape = 'strip' | 'banner' | 'wide' | 'square' | 'tall' | 'tower'

/** A frame as a pattern lays it out. */
export interface FrameRoom {
  width: number
  height: number
  shape: FrameShape
  /** The room left round the edge, in the frame's pixels. */
  margin: number
  /**
   * Where the words, logo and button go: the frame inside its margin, and on a 9:16 frame clear of every platform's
   * interface, its sides alike.
   */
  safe: Rect
  /** The smallest text that reads in the frame, in whole pixels. */
  readable: number
}

/** Each edge of every platform's safe zone together, as deep as the deepest. */
const SAFE_UNION = {
  top: Math.max(...SAFE_ZONES.map((zone) => zone.top)),
  bottom: Math.max(...SAFE_ZONES.map((zone) => zone.bottom)),
  left: Math.max(...SAFE_ZONES.map((zone) => zone.left)),
  right: Math.max(...SAFE_ZONES.map((zone) => zone.right)),
}

/** The shape a frame of this size is arranged for. */
export function frameShape(width: number, height: number): FrameShape {
  const ratio = width / height
  if (ratio >= 5) return 'strip'
  if (ratio >= 2.4) return 'banner'
  if (ratio >= 1.3) return 'wide'
  if (ratio >= 0.75) return 'square'
  if (ratio >= 0.42) return 'tall'
  return 'tower'
}

/** A frame as a pattern lays it out, `share` of its shorter side left round its edge. */
export function frameRoom(width: number, height: number, share: number): FrameRoom {
  const shape = frameShape(width, height)
  const short = Math.min(width, height)
  // A banner's edge room is a share of its height, but not so little that its words touch the edge.
  const margin = Math.round(shape === 'strip' || shape === 'banner' ? Math.max(short * 0.14, 6) : short * share)
  let safe: Rect = { x: margin, y: margin, width: width - 2 * margin, height: height - 2 * margin }
  if (isNineBySixteen(width, height)) {
    const top = Math.max(margin, Math.ceil(SAFE_UNION.top * height))
    const bottom = Math.max(margin, Math.ceil(SAFE_UNION.bottom * height))
    // The sides are kept alike, the deeper one's, so words centred in the frame are centred in the room.
    const side = Math.max(margin, Math.ceil(Math.max(SAFE_UNION.left, SAFE_UNION.right) * width))
    safe = { x: side, y: top, width: width - 2 * side, height: height - top - bottom }
  }
  return { width, height, shape, margin, safe, readable: Math.ceil(readableTextSize(width, height)) }
}

/** A box `by` in from each side of `box`. */
export function inset(box: Rect, by: number): Rect {
  return { x: box.x + by, y: box.y + by, width: box.width - 2 * by, height: box.height - 2 * by }
}

/** The part of `box` that `other` shares with it; a box of no size when they don't meet. */
export function within(box: Rect, other: Rect): Rect {
  const x = Math.max(box.x, other.x)
  const y = Math.max(box.y, other.y)
  const right = Math.min(box.x + box.width, other.x + other.width)
  const bottom = Math.min(box.y + box.height, other.y + other.height)
  return { x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y) }
}
