// What Make editable's finish asks the matchers of a frame's split pieces, and what it places of their answers: which
// pieces are matched, a text piece as the words its planned part says, corrected by the reading, and a shape piece as
// shapes; a piece's match job, the piece's own picture as one piece; the colour the picture shows behind a piece; and
// the layers an answer rebuilds a piece as, placed in the frame where the picture's own fill draws the piece, or
// that the piece stays a picture.
import { scaledSizes } from '@dazbee/doc'
import { imagePlacement, type Pixels } from '@dazbee/renderer'
import {
  type LayerPlanAnswer,
  type MadePiece,
  type MatchAnswer,
  type MatchJob,
  type MatchKit,
  MAX_MATCH_PICTURE_SIDE,
  type ReadingAnswer,
  type Rgb,
  UnplacedLayer,
} from '@dazbee/schema'

/** What a split piece is matched as: text saying `words`, at its tilt in degrees clockwise when known, or shapes. */
export type MatchedAs = { kind: 'text'; words: string; angle?: number } | { kind: 'shape' }

type Size = Pick<Pixels, 'width' | 'height'>
type Placed = Pick<MadePiece, 'x' | 'y' | 'part' | 'picture'>

/** How opaque a piece's pixel may be, 0 to 255, and still show the picture behind the piece. */
const CLEAR = 8
/** The fewest clear pixels a piece's box holds for the colour behind it to be read. */
const LEAST_CLEAR = 16
/** The most characters a text piece's words hold (the match job's rule). */
const MOST_WORDS = 2000
/** A piece holds more than its planned part when it reaches past the part's box by over this share of the box's shorter side. */
const REACHES_PAST = 0.5
/** How many steps the layer plan's grid has along each side of the picture. */
const GRID = 1000

/**
 * What split piece `piece` is matched as, by its frame's plan `plan` and reading `reading`: a text piece as text
 * saying what the reading read of its planned part, else the lines the plan found, else its content; a shape piece
 * as shapes. Null for a piece that stays a picture: any other kind, a piece wider or taller than a match job's
 * picture may be, a text of no part or with no words, and lettering the reading calls custom, which no font draws.
 */
export function matchedAs(
  plan: LayerPlanAnswer | null,
  reading: ReadingAnswer | null,
  piece: Pick<MadePiece, 'part' | 'kind' | 'turned' | 'picture'>,
): MatchedAs | null {
  if (Math.max(piece.picture.width, piece.picture.height) > MAX_MATCH_PICTURE_SIDE) return null
  if (piece.kind === 'shape') return { kind: 'shape' }
  const part = piece.part === null ? undefined : plan?.elements.find((e) => e.id === piece.part)
  if (piece.kind !== 'text' || !part) return null
  const read = reading?.blocks.find((block) => block.id === part.id)
  if (read?.lettering === 'custom') return null
  const said = [read?.text, part.text_lines.join('\n'), part.content].find((words) => words?.trim())
  const words = said?.trim().slice(0, MOST_WORDS).trim()
  if (!words) return null
  return { kind: 'text', words, ...(piece.turned ? { angle: piece.turned.angle } : {}) }
}

/**
 * The match job of a split piece matched as `as`: its own picture `picture`, a PNG as base64, of size `size`, whole,
 * as the job's one piece, with the brand kit `kit` and, for text, the colours it is seen on.
 */
export function pieceMatchJob(
  picture: string,
  size: Size,
  as: MatchedAs,
  kit: MatchKit,
  backgrounds?: readonly Rgb[],
): MatchJob {
  const rect = { x: 0, y: 0, width: size.width, height: size.height }
  return {
    picture,
    pieces: [{ ...as, rect }],
    kit,
    setting: 'hybrid',
    ...(as.kind === 'text' && backgrounds?.length ? { backgrounds: [...backgrounds] } : {}),
  }
}

/**
 * The colour the picture shows behind a split piece: the median of `under`, the picture's pixels under the piece's
 * box, where `piece`, the piece's own pixels of the same size, is clear. Null when the two differ in size or the
 * piece leaves too little of its box clear to tell.
 */
export function seenBehind(under: Pixels, piece: Pixels): Rgb | null {
  if (under.width !== piece.width || under.height !== piece.height) return null
  const channels: [number[], number[], number[]] = [[], [], []]
  for (let i = 0; i < piece.width * piece.height; i++) {
    if ((piece.pixels[i * 4 + 3] ?? 0) >= CLEAR) continue
    for (const [c, values] of channels.entries()) values.push(under.pixels[i * 4 + c] ?? 0)
  }
  if (channels[0].length < LEAST_CLEAR) return null
  const [red, green, blue] = channels.map((values) => values.sort((a, b) => a - b)[values.length >> 1] ?? 0)
  return [red ?? 0, green ?? 0, blue ?? 0]
}

/**
 * The layers the finish places for split piece `piece` of a picture of size `picture` from a matcher's `answer`, in a
 * frame of size `frame` (`matchedLayers`). Null when the piece stays a picture: the matcher kept it one, the answer
 * can't be placed, or the answer is approximate and the piece reaches past its planned part's box in `plan`, when
 * what else the piece holds is what the text was fitted to.
 */
export function rebuiltLayers(
  answer: MatchAnswer | undefined,
  piece: Placed,
  plan: LayerPlanAnswer | null,
  picture: Size,
  frame: Size,
): UnplacedLayer[] | null {
  if (answer?.kind !== 'layers') return null
  if (answer.approximate && reachesPast(piece, plan, picture)) return null
  return matchedLayers(answer.layers, piece, picture, frame)
}

/**
 * The layers `layers` a matcher answered split piece `piece` with, which are in the piece's own pixels, placed in a
 * frame of size `frame`: each box carried over by where the picture's own image fill draws the picture, of size
 * `picture`, in a layer filling the frame, and every size it holds scaled as much (`scaledSizes`). Null when the
 * answer holds a layer that is no text and no graphic, or one that is no layer once placed.
 */
export function matchedLayers(
  layers: readonly UnplacedLayer[],
  piece: Pick<MadePiece, 'x' | 'y'>,
  picture: Size,
  frame: Size,
): UnplacedLayer[] | null {
  if (layers.some((layer) => layer.type !== 'text' && layer.type !== 'graphic')) return null
  const drawn = imagePlacement(picture, { fit: 'fill' }, { x: 0, y: 0, width: frame.width, height: frame.height })
  const k = drawn.width / picture.width
  const placed = layers.map((layer) => {
    const { x, y, width, height } = layer.props
    const props = {
      ...scaledSizes(layer.props, k),
      x: hundredth(drawn.x + (piece.x + x) * k),
      y: hundredth(drawn.y + (piece.y + y) * k),
      width: hundredth(width * k),
      height: hundredth(height * k),
    }
    return { ...layer, props } as UnplacedLayer
  })
  return placed.every((layer) => UnplacedLayer.safeParse(layer).success) ? placed : null
}

/**
 * Whether split piece `piece` of a picture of size `picture` holds more than its planned part: it reaches past the
 * part's box in `plan`, on the plan's grid, by over half the box's shorter side. Never for a piece of no part.
 */
function reachesPast(piece: Placed, plan: LayerPlanAnswer | null, picture: Size): boolean {
  const box = piece.part === null ? undefined : plan?.elements.find((e) => e.id === piece.part)?.box
  if (!box) return false
  const [left, right] = [(box.x_min * picture.width) / GRID, ((box.x_max + 1) * picture.width) / GRID]
  const [top, bottom] = [(box.y_min * picture.height) / GRID, ((box.y_max + 1) * picture.height) / GRID]
  const past = Math.max(
    left - piece.x,
    top - piece.y,
    piece.x + piece.picture.width - right,
    piece.y + piece.picture.height - bottom,
  )
  return past > REACHES_PAST * Math.min(right - left, bottom - top)
}

function hundredth(n: number): number {
  return Math.round(n * 100) / 100
}
