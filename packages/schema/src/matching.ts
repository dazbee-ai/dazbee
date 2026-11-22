// The matchers' contract: a match job, a picture and the pieces of it a matcher rebuilds as layers,
// and the answer for each piece, its layers or why it stays a picture. The browser's matcher
// workers and the matchers' tests and scripts in Node speak it.
import { z } from 'zod'

import { BRAND_KIT_LIMITS } from './brand-roles.ts'
import { BrandTextStyle } from './brand-text-styles.ts'
import { readImageHeader } from './image-header.ts'
import { UnplacedLayer } from './layers.ts'
import { Color } from './primitives.ts'
import { BrandToken } from './variables.ts'

/** The longest side of a match job's picture, in pixels. */
export const MAX_MATCH_PICTURE_SIDE = 2048
/** The most bytes a match job's picture holds once decoded from base64. */
export const MAX_MATCH_PICTURE_BYTES = 8 * 1024 * 1024
/** The most background colours a match job gives. */
export const MAX_MATCH_BACKGROUNDS = 4
/** The most pieces one match job holds. */
export const MAX_MATCH_PIECES = 64

/** An 8-bit sRGB colour as red, green and blue, 0 to 255 each. */
export const Rgb = z.tuple([
  z.number().int().min(0).max(255),
  z.number().int().min(0).max(255),
  z.number().int().min(0).max(255),
])
export type Rgb = z.infer<typeof Rgb>

/** Whether a piece is text, which the text matcher rebuilds, or shapes, which the shape matcher does. */
export const PieceKind = z.enum(['text', 'shape'])
export type PieceKind = z.infer<typeof PieceKind>

const pieceRect = z.object({
  x: z.number().min(0),
  y: z.number().min(0),
  width: z.number().positive(),
  height: z.number().positive(),
})

/**
 * One part of the picture a matcher rebuilds: its kind and its rect in the picture's pixels, and for
 * text the words it says (lines split by `\n`, kept as given) and, when known, its tilt in degrees.
 */
export const Piece = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('text'),
    rect: pieceRect,
    words: z.string().max(2000).regex(/\S/, 'a text piece says some words'),
    angle: z.number().min(-180).max(180).optional(),
  }),
  z.object({ kind: z.literal('shape'), rect: pieceRect }),
])
export type Piece = z.infer<typeof Piece>

/** How finely the text matcher fits: Hybrid, every person's, or Light, its quicker first half. */
export const MatchSetting = z.enum(['hybrid', 'light'])
export type MatchSetting = z.infer<typeof MatchSetting>

/** The brand kit as a matcher reads it: its colours and its fonts' families by token, and its text styles. */
export const MatchKit = z.object({
  colors: z
    .record(BrandToken, Color)
    .refine(
      (colors) => Object.keys(colors).length <= BRAND_KIT_LIMITS.color,
      `a kit holds at most ${BRAND_KIT_LIMITS.color} colours`,
    ),
  fonts: z
    .record(BrandToken, z.string().trim().min(1).max(100))
    .refine(
      (fonts) => Object.keys(fonts).length <= BRAND_KIT_LIMITS.font,
      `a kit holds at most ${BRAND_KIT_LIMITS.font} fonts`,
    ),
  textStyles: BrandTextStyle.array().max(BRAND_KIT_LIMITS.textStyle),
})
export type MatchKit = z.infer<typeof MatchKit>

/** What a match job holds, apart from what only the API adds. */
const matchJobFields = {
  /** The picture as it is drawn on the frame: a PNG, base64 in JSON. */
  picture: z.base64(),
  /** The colours the picture is seen on, for text; left out for shapes. */
  backgrounds: Rgb.array().min(1).max(MAX_MATCH_BACKGROUNDS).optional(),
  pieces: Piece.array().min(1).max(MAX_MATCH_PIECES),
  kit: MatchKit,
  setting: MatchSetting.default('hybrid'),
}

/**
 * A match job: a picture, the pieces of it to rebuild, and the brand kit they may bind to. The
 * picture is a PNG of at most 2048 px on its long side and 8 MB once decoded, and each piece's rect
 * lies inside it.
 */
export const MatchJob = z.object(matchJobFields).superRefine(pictureHoldsPieces, { when: wellFormed })
export type MatchJob = z.infer<typeof MatchJob>

/** The looks-the-same rule's numbers for a rebuild; `inkColour`, the colour guard's ΔE00, for text only. */
export const LooksSameScores = z.object({
  ssim: z.number().min(-1).max(1),
  inkMissed: z.number().min(0).max(1),
  far: z.number().min(0).max(1),
  inkColour: z.number().min(0).optional(),
})
export type LooksSameScores = z.infer<typeof LooksSameScores>

/**
 * Why a piece stays a picture: its rebuild doesn't look the same, it would take too many layers, it
 * is a photo or a painted scene (its shapes leave its shading and texture unexplained, or are many free
 * paths), no font draws its characters, it is too big, or the matcher failed.
 */
export const PictureWhy = z.enum(['looksDifferent', 'tooManyParts', 'photo', 'noFont', 'tooBig', 'failed'])
export type PictureWhy = z.infer<typeof PictureWhy>

/**
 * A matcher's answer for one piece: the layers that rebuild it, or why it stays a picture. Scores are
 * left out of a picture's answer when nothing was drawn to judge.
 */
export const MatchAnswer = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('layers'), layers: UnplacedLayer.array().min(1), scores: LooksSameScores }),
  z.object({ kind: z.literal('picture'), why: PictureWhy, scores: LooksSameScores.optional() }),
])
export type MatchAnswer = z.infer<typeof MatchAnswer>

/** Whether a job parsed with no issue so far, so its picture and pieces can be read. */
function wellFormed(payload: { issues: readonly unknown[] }) {
  return payload.issues.length === 0
}

/** Refuses a picture that isn't a PNG small enough, and a piece whose rect leaves the picture. */
function pictureHoldsPieces(job: { picture: string; pieces: Piece[] }, ctx: z.RefinementCtx) {
  if (base64Bytes(job.picture) > MAX_MATCH_PICTURE_BYTES) {
    ctx.addIssue({ code: 'custom', path: ['picture'], message: `the picture is over ${MAX_MATCH_PICTURE_BYTES} bytes` })
    return
  }
  const header = readImageHeader(base64Head(job.picture))
  if (header?.contentType !== 'image/png') {
    ctx.addIssue({ code: 'custom', path: ['picture'], message: 'the picture is a PNG' })
    return
  }
  if (Math.max(header.width, header.height) > MAX_MATCH_PICTURE_SIDE) {
    ctx.addIssue({
      code: 'custom',
      path: ['picture'],
      message: `the picture is over ${MAX_MATCH_PICTURE_SIDE} px on its long side`,
    })
    return
  }
  job.pieces.forEach(({ rect }, i) => {
    if (rect.x + rect.width > header.width || rect.y + rect.height > header.height) {
      ctx.addIssue({ code: 'custom', path: ['pieces', i, 'rect'], message: 'a piece lies inside the picture' })
    }
  })
}

/** How many bytes padded base64 decodes to, which its length and padding fix exactly. */
function base64Bytes(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0
  return (base64.length / 4) * 3 - padding
}

/** The first 24 bytes base64 decodes to, enough for a PNG's header. */
function base64Head(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64.slice(0, 32)), (char) => char.charCodeAt(0))
}
