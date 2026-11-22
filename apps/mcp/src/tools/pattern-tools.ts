// The tools for patterns: list_patterns tells the patterns an agent can build an ad from, and apply_pattern builds
// one in a style at several sizes of the open design, each frame arranged for its shape, as one agent batch: in the
// empty frame named, and in new frames. Each part's copies are linked copies across the sizes; colours, fonts and the
// kit's logo are bound to the brand roles. Nothing records which pattern built a frame, so everything can be changed.
import { randomBytes } from 'node:crypto'

import { z } from 'zod'

import {
  buildPatterns,
  builtFrames,
  DRAFT,
  draftSuggestions,
  findPattern,
  missingContent,
  PATTERN_STYLES,
  type PatternContent,
  type PatternFrame,
  type PatternLayers,
  PATTERNS,
  patternSteps,
  type PatternStyle,
  type Picture,
  type PictureLook,
  pictureLook,
  unusedContent,
} from '@dazbee/patterns'
import { textMeasure } from '@dazbee/renderer'
import { loadCanvasKit } from '@dazbee/renderer/node'
import {
  type BrandKit,
  inOrder,
  isVectorAsset,
  RecordId,
  SIZE_LIMITS,
  sizeProblem,
  textFontUses,
  type Variables,
} from '@dazbee/schema'

import { ApiRefusal } from '../api.ts'
import type { OpenDesign } from '../open-design.ts'
import { agentBatchOn, answered, Note, refusalOf, writing } from './command-tools.ts'
import { defineTool, type Tool, type ToolContext, ToolRefusal } from './define-tool.ts'
import { FrameId } from './design-tools.ts'
import { frameIn } from './place-on-frame.ts'

/** The content filled in from the brand's assets, and what of the content given is left out of the ad. */
interface Filled {
  content: PatternContent
  leftOut: string[]
}

/** The most sizes one call builds. */
const MOST_SIZES = 12
/** The longest a text of the content may be. */
const MOST_WORDS = 300
/** The styles, as a sentence names them. */
const STYLES_SAID = `${PATTERN_STYLES.slice(0, -1).join(', ')} and ${PATTERN_STYLES.at(-1)}`

/** A size a pattern is built at. */
const Size = z
  .object({
    width: z.number().int().min(SIZE_LIMITS.minSide).max(SIZE_LIMITS.maxSide).describe('Its width, in pixels'),
    height: z.number().int().min(SIZE_LIMITS.minSide).max(SIZE_LIMITS.maxSide).describe('Its height, in pixels'),
  })
  .strict()

/** A text of the content. */
const Words = (what: string) => z.string().trim().min(1).max(MOST_WORDS).describe(what)

/** What a pattern is filled with. */
const Content = z
  .object({
    headline: Words('The headline; for the quote pattern, what was said'),
    subline: Words('A line under the headline').optional(),
    kicker: Words('A short line over the headline, such as “New season”').optional(),
    button: Words('The button’s label, such as “Shop now”').optional(),
    highlight: Words('Words of the headline to set apart, as they are written in it').optional(),
    badge: Words('An offer’s few words, such as “−30%” or “New” (product-badge, coupon)').optional(),
    number: Words(
      'A figure such as “50%” or “3×” (big-number), a price (price-tag) or a date such as “28 Nov” (event-date, ticket)',
    ).optional(),
    attribution: Words('Who said the quote, such as “Priya Nair, runner” (quote)').optional(),
    photo: RecordId.describe(
      'A photo of the brand’s, its id as list_assets gives it: an image, not an SVG file',
    ).optional(),
    logo: z
      .union([RecordId, z.literal(false)])
      .describe(
        'The logo, an image of the brand’s by its id; the brand kit’s logo, bound to brand:logo, when left out; false for none',
      )
      .optional(),
  })
  .strict()
  .describe('The words and pictures the pattern is filled with; list_patterns says what each pattern needs and takes')

export const PATTERN_TOOLS: Tool[] = [
  defineTool({
    name: 'list_patterns',
    title: 'List patterns',
    description: `Lists the patterns apply_pattern builds an ad from: proven structures, each arranged for every size, filled from the brand kit and the content given. Each has its id, name, the kinds of ad it suits, what content it needs and takes, and a line on what it is; \`kind\` keeps those that suit a kind of ad, such as “sale or offer”. Every pattern comes in the styles ${STYLES_SAID}.`,
    readOnly: true,
    input: z.object({
      kind: z.string().trim().min(1).max(60).optional().describe('A kind of ad, such as “sale or offer” or “quote”'),
    }),
    run: async ({ kind }) => {
      const wanted = kind?.toLowerCase()
      const patterns = PATTERNS.filter(
        (pattern) => !wanted || pattern.kinds.some((each) => each.includes(wanted) || wanted.includes(each)),
      )
      if (patterns.length === 0)
        return `No pattern suits “${kind}”; list_patterns without a kind lists them all, by the kinds they suit`
      return { patterns, styles: PATTERN_STYLES }
    },
  }),
  defineTool({
    name: 'apply_pattern',
    title: 'Build an ad from a pattern',
    description: `Builds a pattern (list_patterns) in a style at each size given, one frame a size, each arranged for its shape, as one undo step, and answers once Dazbee has stored it: each frame's id, name, size and the ids of the layers it made by the part each is, what of the content was left out, and the warnings. The first size goes in \`frame\` when it names an empty frame, at that frame's size; the rest go in new frames on its page, or the first page. Each part's copies in the sizes are linked copies; colours, fonts and the kit's logo are bound to the brand roles, the style's own where a role is not set. What it builds is a first draft, never the finished ad: its answer suggests ways to make it the brand's own; change those or anything else, then look at each frame with render_frame and fix what check_frame warns of. Use a pattern only where one fits the brief; for a brief that asks for something distinctive, design from scratch. Up to ${MOST_SIZES} sizes.`,
    readOnly: false,
    input: z.object({
      pattern: z.string().trim().min(1).max(60).describe('The pattern’s id, as list_patterns gives it'),
      style: z.enum(PATTERN_STYLES).describe(`The style: ${STYLES_SAID.replace(' and ', ' or ')}`),
      sizes: z
        .array(Size)
        .max(MOST_SIZES)
        .optional()
        .describe('The sizes to build it at, each in a new frame, such as 1080 × 1080, 1080 × 1920 and 1200 × 628'),
      frame: FrameId.optional().describe('An empty frame of the open design to build it in first, at its own size'),
      content: Content,
      note: Note,
    }),
    run: ({ pattern, style, sizes = [], frame, content, note }, context) =>
      writing(context, [], async (open) => {
        const found = findPattern(pattern)
        if (!found) throw new ToolRefusal(`There is no pattern “${pattern}”; list_patterns lists them`)
        // The logo is the kit's where none is named, so a pattern that needs one is refused only once that is known.
        const missing = missingContent(found, content).filter((part) => part !== 'logo')
        if (missing.length > 0)
          throw new ToolRefusal(`The ${found.id} pattern needs ${missing.join(', ')} in the content; nothing was built`)
        const { pageId, frames } = framesFor(open, frame, sizes)
        const kit = await context.api.brandKit(open.brandId)
        const filled = await contentOf(context, open, content, kit.logoAssetId)
        if (missingContent(found, filled.content).includes('logo'))
          throw new ToolRefusal(
            `The ${found.id} pattern needs a logo: name an image of the brand’s in content.logo, or set the brand kit’s logo; nothing was built`,
          )
        const layers = await built(open, found.id, style, frames, filled.content, kit)
        const done = await agentBatchOn(open, patternSteps(pageId, layers, freshId), context.answerBy, note)
        const { kept, steps: outcomes, warnings, warningsError } = done.value
        if (!kept) throw new ToolRefusal(refusalOf(outcomes.find((step) => !step.ok)))
        const design = open.tab.design()
        const leftOut = [
          ...unusedContent(found, content).map((part) => `${part}: the pattern doesn’t use it`),
          ...filled.leftOut,
        ]
        return answered(open, done, {
          frames: builtFrames(frames, outcomes).map(({ frameId, layers: ids }, i) => ({
            id: frameId,
            name: design.frames[frameId]?.name ?? '',
            width: frames[i]?.width,
            height: frames[i]?.height,
            layers: ids,
          })),
          ...(leftOut.length > 0 ? { leftOut } : {}),
          draft: DRAFT,
          suggestions: draftSuggestions(found, style, kit, filled.content),
          warnings,
          ...(warningsError === undefined ? {} : { warningsError }),
        })
      }),
  }),
]

/** A new id for a link or a layer: 120 random bits, as letters, digits, - and _. */
function freshId(): string {
  return randomBytes(15).toString('base64url')
}

/** The page the frames go on and each size's frame: the empty frame named first, at its size, then new ones. */
function framesFor(
  open: OpenDesign,
  frameId: string | undefined,
  sizes: readonly PatternFrame[],
): { pageId: string; frames: PatternFrame[] } {
  const design = open.tab.design()
  if (!frameId && sizes.length === 0) throw new ToolRefusal('Give the sizes to build at, or an empty frame to build in')
  for (const { width, height } of sizes) {
    const problem = sizeProblem(width, height)
    if (problem) throw new ToolRefusal(`${width} × ${height} is no frame’s size: ${problem}`)
  }
  if (frameId) {
    const frame = frameIn(open, frameId)
    if (Object.values(design.nodes).some((node) => node.parentId === frameId))
      throw new ToolRefusal(`The frame “${frameId}” isn’t empty; name an empty frame, or leave frame out for new ones`)
    if (sizes.length + 1 > MOST_SIZES) throw new ToolRefusal(`A pattern is built at ${MOST_SIZES} sizes at most`)
    return { pageId: frame.pageId, frames: [{ frameId, width: frame.width, height: frame.height }, ...sizes] }
  }
  const [first] = inOrder(design.pages)
  if (!first) throw new ToolRefusal('The open design has no page to add frames to')
  return { pageId: first[0], frames: [...sizes] }
}

/**
 * The content with its pictures' sizes read from the brand's assets, and the kit's logo where none is named; a kit
 * logo that is an SVG file is left out, and said so.
 */
async function contentOf(
  { api }: ToolContext,
  open: OpenDesign,
  { photo, logo, ...words }: z.output<typeof Content>,
  kitLogo: string | null,
): Promise<Filled> {
  const leftOut: string[] = []
  const picture = async (assetId: string, what: 'photo' | 'logo'): Promise<Picture | undefined> => {
    let summary
    try {
      summary = (await api.asset(open.brandId, assetId)).summary
    } catch (error) {
      if (error instanceof ApiRefusal && error.status === 404)
        throw new ToolRefusal(`The brand has no image “${assetId}” for the ${what}; list_assets lists them`)
      throw error
    }
    if (!isVectorAsset(summary)) {
      const look = await lookOf(open, assetId, summary)
      return { assetId, width: summary.width, height: summary.height, ...(look ? { look } : {}) }
    }
    if (what === 'logo' && logo === undefined) {
      leftOut.push(
        `logo: the brand kit’s logo is an SVG file, which a pattern doesn’t place; place it with place_asset`,
      )
      return undefined
    }
    throw new ToolRefusal(
      `The ${what} “${assetId}” is an SVG file; give an image, or place the SVG with place_asset after`,
    )
  }
  const logoId = logo === false ? null : (logo ?? kitLogo)
  const placedPhoto = photo ? await picture(photo, 'photo') : undefined
  const placedLogo = logoId ? await picture(logoId, 'logo') : undefined
  // The words given; one left out is left out of the content.
  const given = Object.fromEntries(Object.entries(words).filter(([, value]) => value !== undefined))
  const content = {
    ...(given as Omit<PatternContent, 'photo' | 'logo'>),
    ...(placedPhoto ? { photo: placedPhoto } : {}),
    ...(placedLogo ? { logo: placedLogo } : {}),
  }
  return { content, leftOut }
}

/**
 * What a picture shows, read from its pixels, so a photo is cropped to its subject and a logo set where its ink
 * reads, its subject's box in the pixels of the picture's `size` as the brand's assets give it; none where its bytes
 * can't be read or decoded, and the pattern places it as it would an unread picture.
 */
async function lookOf(
  open: OpenDesign,
  assetId: string,
  size: { width: number; height: number },
): Promise<PictureLook | undefined> {
  const bytes = await open.imageBytes(assetId).catch(() => undefined)
  if (!bytes) return undefined
  const ck = await loadCanvasKit()
  const image = ck.MakeImageFromEncoded(bytes)
  if (!image) return undefined
  try {
    const width = image.width()
    const height = image.height()
    const info = {
      width,
      height,
      colorType: ck.ColorType.RGBA_8888,
      alphaType: ck.AlphaType.Unpremul,
      colorSpace: ck.ColorSpace.SRGB,
    }
    const rgba = image.readPixels(0, 0, info)
    if (!(rgba instanceof Uint8Array)) return undefined
    const look = pictureLook(rgba, width, height)
    const [sx, sy] = [size.width / width, size.height / height]
    const { subject } = look
    return {
      ...look,
      subject: { x: subject.x * sx, y: subject.y * sy, width: subject.width * sx, height: subject.height * sy },
    }
  } finally {
    image.delete()
  }
}

/**
 * Each size's layers, built together as one set and measured with the fonts they are set in: built once to learn
 * which faces their texts use, those faces loaded into the tab, then built again measured with them.
 */
async function built(
  open: OpenDesign,
  pattern: string,
  style: PatternStyle,
  frames: readonly PatternFrame[],
  content: PatternContent,
  kit: BrandKit,
) {
  const { tab } = open
  const ck = await loadCanvasKit()
  const build = () => {
    const measure = textMeasure(ck, tab.cache.resources(tab.bytes()))
    const layers = buildPatterns(pattern, { style, kit, content, measure }, frames)
    return frames.map((frame, i) => ({ frame, layers: layers[i] ?? { nodes: {}, roots: [] } }))
  }
  const variables = tab.bytes().variables
  await tab.fontsFor(build().flatMap(({ layers }) => usesOf(layers, variables)))
  return build()
}

/** The faces a pattern's texts are drawn in. */
function usesOf(layers: PatternLayers, variables: Variables | undefined) {
  return Object.values(layers.nodes).flatMap((node) => (node.type === 'text' ? textFontUses(node, variables) : []))
}
