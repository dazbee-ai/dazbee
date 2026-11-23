// Where a box or the caret of the text being edited is shown in its frame: moved from the text's
// layout to its place, mirrored as the text is flipped, and turned as the letters it is on are.
import { flippedPoint, flippedRect, type Flips } from '@dazbee/doc'
import type { CaretLine, TurnedRect } from '@dazbee/renderer'
import type { Rect } from '@dazbee/schema'

/**
 * A box of a text's layout (its own coordinates, before `dy`) in its frame's design pixels: moved by
 * the text's place and `dy`, and mirrored as the text is flipped, a turned box turned the other way
 * when one flip mirrors it.
 */
export function shownBox(box: TurnedRect, props: Rect & Flips, dy: number): TurnedRect {
  const moved = { ...box, x: props.x + box.x, y: props.y + dy + box.y }
  if (!box.turn) return flippedRect(moved, props)
  const angle = (box.turn * Math.PI) / 180
  const [cos, sin] = [Math.cos(angle), Math.sin(angle)]
  // The corner that becomes its top left: across from it on each flipped axis.
  const across = props.flipX ? box.width : 0
  const down = props.flipY ? box.height : 0
  const corner = flippedPoint({ x: moved.x + cos * across - sin * down, y: moved.y + sin * across + cos * down }, props)
  const mirrored = Boolean(props.flipX) !== Boolean(props.flipY)
  return { ...corner, width: box.width, height: box.height, turn: mirrored ? -box.turn : box.turn }
}

/** A caret of a text's layout in its frame's design pixels, as `shownBox` places a box. */
export function shownCaret(caret: CaretLine, props: Rect & Flips, dy: number): CaretLine {
  const { x, y, height, turn } = shownBox({ ...caret, width: 0 }, props, dy)
  return turn ? { x, y, height, turn } : { x, y, height }
}
