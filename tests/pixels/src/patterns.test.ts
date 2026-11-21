// Every pattern in every style at every size of the Meta, TikTok and YouTube, and Google Display channels, built
// with a stand-in brand's kit, logo, photo and words by the agent batch apply_pattern runs: each frame's design
// check is clean. Built with no brand kit at a square, a story and a wide frame, each style's own colours and fonts
// give a clean check too. With PATTERN_PICTURES naming a folder, each frame is drawn there as a PNG, with an
// index.html that shows them by pattern and style, for the owner to review.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

import { copiesOf } from '@dazbee/doc'
import type { AgentBatchWarned } from '@dazbee/export'
import { PATTERN_STYLES, PATTERNS } from '@dazbee/patterns'
import { renderDesign, type ResourceBytes } from '@dazbee/renderer'
import { brandVariables, type Design, EMPTY_BRAND_KIT, type Frame, framesOf } from '@dazbee/schema'

import { rgbaAt } from './pixels.ts'
import { builtPattern, CHANNEL_SIZES, ck, STRIDE_KIT } from './test-patterns.ts'

/** A picture drawn for the review: which set, pattern and style it is of, its file and its size. */
interface Drawn {
  set: 'kit' | 'no-kit'
  pattern: string
  style: string
  file: string
  width: number
  height: number
}

/** Where the pictures go, when asked for. */
const PICTURES = process.env.PATTERN_PICTURES
/** The sizes a pattern is checked at with no brand kit: a square, a story and a wide frame. */
const KITLESS_SIZES = [
  { width: 1080, height: 1080 },
  { width: 1080, height: 1920 },
  { width: 1280, height: 720 },
]

/** The pictures drawn so far. */
const drawn: Drawn[] = []

describe.each(PATTERNS.map((pattern) => [pattern.id]))('the %s pattern', (id) => {
  it.each(PATTERN_STYLES.map((style) => [style]))(
    'draws in the %s style at every channel size with a clean design check',
    async (style) => {
      const { session, result, bytes } = await builtPattern(id, style, CHANNEL_SIZES)
      const design = session.design()
      const frames = framesOf(design, 'p1')
      if (PICTURES) drawFrames(design, frames, bytes, { set: 'kit', pattern: id, style })
      expect(frames.map(([, frame]) => [frame.width, frame.height])).toEqual(
        CHANNEL_SIZES.map(({ width, height }) => [width, height]),
      )
      expect(told(design, result)).toEqual([])
    },
    120_000,
  )

  it.each(PATTERN_STYLES.map((style) => [style]))(
    'draws in the %s style’s own colours and fonts, with no brand kit, with a clean design check',
    async (style) => {
      const { session, result, bytes } = await builtPattern(id, style, KITLESS_SIZES, { kit: EMPTY_BRAND_KIT })
      const design = session.design()
      if (PICTURES) drawFrames(design, framesOf(design, 'p1'), bytes, { set: 'no-kit', pattern: id, style })
      expect(told(design, result)).toEqual([])
    },
    60_000,
  )
})

describe('a pattern’s frames', () => {
  it('hold linked copies of each text, which Copy to other frames reaches in every size', async () => {
    const { session } = await builtPattern('words-only', 'bold', CHANNEL_SIZES)
    const design = session.design()
    const headlines = Object.entries(design.nodes).filter(([, node]) => node.name === 'Headline')
    expect(headlines).toHaveLength(CHANNEL_SIZES.length)
    const [[first = ''] = []] = headlines
    const others = headlines.slice(1).map(([id]) => id)
    expect(copiesOf(design, first).sort()).toEqual(others.sort())
  })

  it('change with the brand kit: a new primary colour draws the ground in it', async () => {
    const { session, bytes } = await builtPattern('words-only', 'bold', [{ width: 1080, height: 1080 }])
    const design = session.design()
    const [[frameId] = ['']] = framesOf(design, 'p1')
    const green = {
      ...STRIDE_KIT,
      colors: STRIDE_KIT.colors.map((c) => (c.token === 'primary' ? { ...c, value: '#0A7A3FFF' } : c)),
    }
    const before = renderDesign(ck, design, frameId, bytes)
    const after = renderDesign(ck, design, frameId, {
      ...bytes,
      variables: brandVariables(green, { id: 'logo', contentType: 'image/png' }),
    })
    // A pixel of the ground, clear of the words and the decoration, near the frame's left edge half way down.
    const at = (image: { width: number; pixels: Uint8Array }) => rgbaAt(image, 12, 540)
    expect(at(before)).toEqual([255, 90, 54, 255])
    expect(at(after)).toEqual([10, 122, 63, 255])
  })
})

afterAll(() => {
  if (!PICTURES || drawn.length === 0) return
  writeFileSync(join(PICTURES, 'index.html'), reviewPage())
})

/** What a batch was told: its refused steps, why its warnings failed, and each warning with its layer's frame. */
function told(design: Design, result: AgentBatchWarned): string[] {
  const frameOf = (layerId: string) => {
    let at = design.nodes[layerId]?.parentId
    while (at && design.nodes[at]) at = design.nodes[at]?.parentId
    return at ? design.frames[at]?.name : '?'
  }
  return [
    ...result.steps.flatMap((step) => (step.ok ? [] : [`${step.command}: ${step.reason}`])),
    ...(result.warningsError === undefined ? [] : [result.warningsError]),
    ...result.warnings.map(
      ({ layerId, message }) => `${design.nodes[layerId]?.name ?? layerId} in ${frameOf(layerId)}: ${message}`,
    ),
  ]
}

/** Draws each frame as a PNG in the pictures' folder. */
function drawFrames(
  design: Design,
  frames: [string, Frame][],
  bytes: ResourceBytes,
  { set, pattern, style }: Pick<Drawn, 'set' | 'pattern' | 'style'>,
) {
  if (!PICTURES) return
  mkdirSync(PICTURES, { recursive: true })
  for (const [frameId, frame] of frames) {
    const file = `${set}-${pattern}-${style}-${frame.width}x${frame.height}.png`
    writeFileSync(join(PICTURES, file), renderDesign(ck, design, frameId, bytes).png)
    drawn.push({ set, pattern, style, file, width: frame.width, height: frame.height })
  }
}

/**
 * The review page: each pattern, then each style, its frames with the stand-in brand side by side at a common
 * height, then the same style with no brand kit.
 */
function reviewPage(): string {
  const row = (pictures: Drawn[]) =>
    `<div class="row">${pictures
      .map(
        ({ file, width, height }) =>
          `<figure><img src="${file}" style="height:${Math.round(Math.min(320, Math.max(60, height / 4)))}px" loading="lazy"><figcaption>${width} × ${height}</figcaption></figure>`,
      )
      .join('')}</div>`
  const sections = PATTERNS.map((pattern) => {
    const styles = PATTERN_STYLES.map((style) => {
      const of = (set: Drawn['set']) =>
        drawn.filter((each) => each.set === set && each.pattern === pattern.id && each.style === style)
      const kitless = of('no-kit')
      const own =
        kitless.length > 0 ? `<h4>${style}, no brand kit: the style’s own colours and fonts</h4>${row(kitless)}` : ''
      return `<h3>${style}</h3>${row(of('kit'))}${own}`
    }).join('')
    return `<section><h2>${pattern.name}</h2><p>${pattern.description}</p>${styles}</section>`
  }).join('')
  const css =
    'body{font:15px/1.4 system-ui,sans-serif;margin:24px;background:#f4f4f2;color:#1b1b1b}h2{margin:48px 0 4px}h3{margin:20px 0 8px;text-transform:capitalize}h4{margin:14px 0 8px;font-weight:500;color:#555}.row{display:flex;flex-wrap:wrap;gap:16px;align-items:flex-end}figure{margin:0}img{display:block;box-shadow:0 1px 4px rgba(0,0,0,.18);background:#fff}figcaption{font-size:12px;color:#666;margin-top:4px}'
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Patterns for review</title><style>${css}</style></head><body><h1>Patterns for review</h1><p>Each pattern in each style at every Meta, TikTok and YouTube, and Google Display size, built with a stand-in sneaker brand (its colours and logo, no fonts of its own, so each style’s font pairing shows), and at a square, a story and a wide frame with no brand kit. Every frame’s design check is clean.</p>${sections}</body></html>`
}
