// What Make editable's finish asks the matchers of a frame's split pieces, and what it places of their answers: which
// pieces are matched, a text piece as the words its planned part says, corrected by the reading, and a shape, a
// graphic or a background piece as shapes; a piece's match job, the piece's own picture as one piece; the colour the
// picture shows behind a piece; what the pieces in front of a piece hide of it; and the layers an answer rebuilds a
// piece as, placed in the frame where the picture's own fill draws the piece, or that the piece stays a picture.
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

/**
 * What a frame's split pieces cover of its picture so far, front to back: the picture's size, and a byte a pixel, row
 * by row from the top left, 1 where a piece covers it.
 */
export interface Cover {
  width: number
  height: number
  covered: Uint8Array
}

type Size = Pick<Pixels, 'width' | 'height'>
type Placed = Pick<MadePiece, 'x' | 'y' | 'part' | 'picture'>

/** The kinds of split piece the shape matcher is asked of. */
const AS_SHAPES: ReadonlySet<MadePiece['kind']> = new Set(['shape', 'graphic', 'background'])
/** How opaque a piece's pixel may be, 0 to 255, and still show the picture behind the piece. */
const CLEAR = 8
/** How opaque a piece's pixel is, 0 to 255, from which it covers what lies behind the piece. */
const COVERS = 128
/** The fewest clear pixels a piece's box holds for the colour behind it to be read. */
const LEAST_CLEAR = 16
/** How many values a channel of a pixel takes. */
const VALUES = 256
/** The most characters a text piece's words hold (the match job's rule). */
const MOST_WORDS = 2000
/** A piece holds more than its planned part when it reaches past the part's box by over this share of the box's shorter side. */
const REACHES_PAST = 0.5
/** How many steps the layer plan's grid has along each side of the picture. */
const GRID = 1000

/**
 * What split piece `piece` is matched as, by its frame's plan `plan` and reading `reading`: a text piece as text
 * saying what the reading read of its planned part, else the lines the plan found, else its content; a shape, a
 * graphic or a background piece as shapes, which the shape matcher keeps a picture when it is a photo or shaded art.
 * Null for a piece that stays a picture unasked: any other kind, a piece wider or taller than a match job's picture
 * may be, a text of no part or with no words, and lettering the reading calls custom, which no font draws.
 */
export function matchedAs(
  plan: LayerPlanAnswer | null,
  reading: ReadingAnswer | null,
  piece: Pick<MadePiece, 'part' | 'kind' | 'turned' | 'picture'>,
): MatchedAs | null {
  if (Math.max(piece.picture.width, piece.picture.height) > MAX_MATCH_PICTURE_SIDE) return null
  if (AS_SHAPES.has(piece.kind)) return { kind: 'shape' }
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
 * as the job's one piece, with the brand kit `kit`, the colours `backgrounds` it is seen on when any are given, and
 * for shapes `hidden`, what the frame's other pieces hide of it, one bit a pixel as base64 (`hiddenBits`), when given.
 */
export function pieceMatchJob(
  picture: string,
  size: Size,
  as: MatchedAs,
  kit: MatchKit,
  backgrounds?: readonly Rgb[],
  hidden?: string,
): MatchJob {
  const rect = { x: 0, y: 0, width: size.width, height: size.height }
  return {
    picture,
    pieces: [{ ...as, rect }],
    kit,
    setting: 'hybrid',
    ...(backgrounds?.length ? { backgrounds: [...backgrounds] } : {}),
    ...(as.kind === 'shape' && hidden !== undefined ? { hidden } : {}),
  }
}

/**
 * The colour the picture shows behind a split piece: the median of `under`, the picture's pixels under the piece's
 * box, where `piece`, the piece's own pixels of the same size, is clear: a channel, the value in the middle of
 * those pixels' values in order, the upper of the two for an even count. It counts how many pixels have each value,
 * so it holds no pixel. Null when the two differ in size or the piece leaves too little of its box clear to tell.
 */
export function seenBehind(under: Pixels, piece: Pixels): Rgb | null {
  if (under.width !== piece.width || under.height !== piece.height) return null
  // How many clear pixels have each value, 256 counts a channel: red's, then green's, then blue's.
  const counts = new Uint32Array(3 * VALUES)
  let clear = 0
  for (let i = 0; i < piece.width * piece.height; i++) {
    if ((piece.pixels[i * 4 + 3] ?? 0) >= CLEAR) continue
    clear++
    for (let channel = 0; channel < 3; channel++) {
      const at = channel * VALUES + (under.pixels[i * 4 + channel] ?? 0)
      counts[at] = (counts[at] ?? 0) + 1
    }
  }
  if (clear < LEAST_CLEAR) return null
  return [middleValue(counts, 0, clear), middleValue(counts, 1, clear), middleValue(counts, 2, clear)]
}

/** The cover of a picture of size `picture` before any piece covers it. */
export function noCover(picture: Size): Cover {
  return { width: picture.width, height: picture.height, covered: new Uint8Array(picture.width * picture.height) }
}

/**
 * Adds to `cover` what split piece `piece` covers of the picture: each pixel where `drawn`, the piece's own pixels,
 * is at least half opaque. What reaches past the picture covers nothing.
 */
export function coverWith(cover: Cover, piece: Pick<MadePiece, 'x' | 'y'>, drawn: Pixels): void {
  const across = Math.min(drawn.width, cover.width - piece.x)
  const down = Math.min(drawn.height, cover.height - piece.y)
  for (let y = 0; y < down; y++) {
    for (let x = 0; x < across; x++) {
      if ((drawn.pixels[(y * drawn.width + x) * 4 + 3] ?? 0) < COVERS) continue
      cover.covered[(piece.y + y) * cover.width + piece.x + x] = 1
    }
  }
}

/**
 * What `cover`, the pieces in front, hides of split piece `piece`: a byte a pixel of the piece's own picture, row by
 * row from its top left, 1 where they cover it. Null when they cover none of it.
 */
export function hiddenUnder(cover: Cover, piece: Pick<MadePiece, 'x' | 'y' | 'picture'>): Uint8Array | null {
  const { width, height } = piece.picture
  const across = Math.min(width, cover.width - piece.x)
  const down = Math.min(height, cover.height - piece.y)
  const hidden = new Uint8Array(width * height)
  let any = false
  for (let y = 0; y < down; y++) {
    for (let x = 0; x < across; x++) {
      if (!cover.covered[(piece.y + y) * cover.width + piece.x + x]) continue
      hidden[y * width + x] = 1
      any = true
    }
  }
  return any ? hidden : null
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
 * The value at index `count >> 1` of channel `channel`'s `count` values in order, read from `counts`, how many of
 * them have each value.
 */
function middleValue(counts: Uint32Array, channel: number, count: number): number {
  let upTo = 0
  for (let value = 0; value < VALUES; value++) {
    upTo += counts[channel * VALUES + value] ?? 0
    if (upTo > count >> 1) return value
  }
  return VALUES - 1
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
