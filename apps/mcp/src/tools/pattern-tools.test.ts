import { afterEach, describe, expect, it } from 'vitest'

import { testDesign } from '@dazbee/doc/test-design'
import { PATTERNS } from '@dazbee/patterns'
import type { DesignInput } from '@dazbee/schema'

import { type TestServer, testServer, textOf } from '../test-client.ts'

/** A layer as a design holds it. */
interface StoredLayer {
  type: string
  name: string
  parentId: string
  link: string
  bindings?: Record<string, unknown>
  props: Record<string, unknown>
}

/** A design's frames and layers, as the sync server holds them. */
interface Stored {
  frames: Readonly<Record<string, { name: string; width: number; height: number; pageId: string }>>
  nodes: Readonly<Record<string, StoredLayer>>
}

/** What apply_pattern answers. */
interface Applied {
  frames: { id: string; name: string; width: number; height: number; layers: Record<string, string> }[]
  leftOut?: string[]
  warnings: unknown[]
}

let server: TestServer

afterEach(async () => {
  await server.endpoint.close()
})

/** The design the tests open. */
const LAUNCH = { brand: 'brand-summer', design: 'design-launch' }
/** Words only, as a marketer gives them. */
const WORDS = {
  kicker: 'Members only',
  headline: 'Free delivery on every order',
  highlight: 'Free delivery',
  subline: 'Join today.',
  button: 'Join free',
}
/** The test design with an empty 300 × 250 frame on its page. */
const WITH_EMPTY: DesignInput = {
  ...testDesign(),
  frames: {
    ...testDesign().frames,
    blank: { pageId: 'p1', name: 'Blank', width: 300, height: 250, x: 0, y: 1200, order: 'a2' },
  },
}

/** An agent with the launch design open, holding `design` when given. */
async function opened(design?: DesignInput) {
  server = testServer(design ? { designs: { 'design-launch': design } } : {})
  const agent = await server.connect(server.api.addAccess().token())
  expect((await agent.call('open_design', LAUNCH)).isError).toBeFalsy()
  return { agent, sync: server.sync('design-launch') }
}

/** The design as the sync server holds it. */
function stored(sync: ReturnType<TestServer['sync']>): Stored {
  return sync.state() as unknown as Stored
}

describe('list_patterns', () => {
  it('lists every pattern with what it needs and takes, and the styles', async () => {
    server = testServer()
    const agent = await server.connect(server.api.addAccess().token())
    const listed = (await agent.json('list_patterns')) as {
      patterns: { id: string; needs: string[] }[]
      styles: string[]
    }
    expect(listed.patterns.map(({ id }) => id)).toEqual(PATTERNS.map(({ id }) => id))
    expect(listed.patterns.find(({ id }) => id === 'big-number')?.needs).toEqual(['headline', 'number'])
    expect(listed.styles).toEqual(['bold', 'minimal', 'playful', 'premium'])
  })

  it('keeps those that suit a kind of ad, and says so when none does', async () => {
    server = testServer()
    const agent = await server.connect(server.api.addAccess().token())
    const quotes = (await agent.json('list_patterns', { kind: 'testimonial' })) as { patterns: { id: string }[] }
    expect(quotes.patterns.map(({ id }) => id)).toEqual(['quote'])
    expect(textOf(await agent.call('list_patterns', { kind: 'zzqq' }))).toContain('No pattern suits')
  })
})

describe('apply_pattern', () => {
  it('builds a frame a size in one undo step, the texts linked across the sizes and the colours, fonts and logo bound', async () => {
    const { agent, sync } = await opened()
    const before = stored(sync)
    const answer = (await agent.json('apply_pattern', {
      pattern: 'words-only',
      style: 'bold',
      sizes: [
        { width: 1080, height: 1080 },
        { width: 1080, height: 1920 },
      ],
      content: WORDS,
    })) as Applied
    expect(answer.frames.map(({ name, width, height }) => [name, width, height])).toEqual([
      ['1080 × 1080', 1080, 1080],
      ['1080 × 1920', 1080, 1920],
    ])
    const design = stored(sync)
    const [square, story] = answer.frames.map(({ layers }) => layers)
    const layer = (id: string | undefined) => design.nodes[id ?? ''] as StoredLayer
    // Each part's copies share one link id, so a change to the headline goes to every size with Copy to other frames.
    for (const part of ['headline', 'subline', 'kicker', 'button-label', 'background', 'logo'])
      expect(layer(square?.[part]).link).toBe(layer(story?.[part]).link)
    // The headline's words that belong together are joined by no-break spaces, alike at every size.
    expect(layer(square?.headline).props.text).toBe(layer(story?.headline).props.text)
    expect(String(layer(square?.headline).props.text).replaceAll(' ', ' ')).toBe(WORDS.headline)
    expect(layer(square?.headline).bindings).toMatchObject({ fontFamily: 'brand:heading' })
    expect(layer(square?.subline).bindings).toMatchObject({ fontFamily: 'brand:body' })
    expect(layer(square?.ground).bindings).toEqual({ fill: 'brand:primary' })
    expect(layer(square?.logo).bindings).toEqual({ image: 'brand:logo' })
    // The kit's heading font and primary colour are what the layers hold.
    expect(layer(square?.headline).props.style).toMatchObject({ fontFamily: 'Brand Serif' })
    expect(layer(square?.ground).props.fills).toEqual([{ type: 'solid', color: '#FF5A36FF' }])
    // Nothing remembers the pattern that built the frames.
    expect(JSON.stringify(design)).not.toMatch(/words-only|Words only|pattern/i)
    expect(textOf(await agent.call('undo'))).toMatch(/^Undid /)
    expect(Object.keys(stored(sync).frames)).toEqual(Object.keys(before.frames))
    expect(Object.keys(stored(sync).nodes)).toEqual(Object.keys(before.nodes))
  })

  it('builds in the empty frame named first, at its size, and the other sizes in new frames on its page', async () => {
    const { agent, sync } = await opened(WITH_EMPTY)
    const answer = (await agent.json('apply_pattern', {
      pattern: 'photo-band',
      style: 'minimal',
      frame: 'blank',
      sizes: [{ width: 728, height: 90 }],
      content: { headline: 'Run further', photo: 'asset-bottle', logo: false },
    })) as Applied
    expect(answer.frames.map(({ id, width, height }) => [id === 'blank', width, height])).toEqual([
      [true, 300, 250],
      [false, 728, 90],
    ])
    const design = stored(sync)
    expect(design.frames[answer.frames[1]?.id ?? '']?.pageId).toBe('p1')
    const photo = design.nodes[answer.frames[0]?.layers.photo ?? '']
    expect(photo?.props.fills).toMatchObject([{ type: 'image', assetId: 'asset-bottle' }])
    expect(answer.frames[0]?.layers).not.toHaveProperty('logo')
  })

  it('binds a logo it is given to brand:logo only when it is the kit’s, and says what of the content it left out', async () => {
    const { agent, sync } = await opened()
    const answer = (await agent.json('apply_pattern', {
      pattern: 'words-only',
      style: 'minimal',
      sizes: [{ width: 1080, height: 1080 }],
      content: { ...WORDS, highlight: 'nowhere', attribution: 'Priya', logo: 'asset-bottle' },
    })) as Applied
    const logo = stored(sync).nodes[answer.frames[0]?.layers.logo ?? '']
    expect(logo?.props.fills).toMatchObject([{ type: 'image', assetId: 'asset-bottle' }])
    expect(logo?.bindings).toBeUndefined()
    expect(answer.leftOut).toEqual(['attribution: the pattern doesn’t use it', 'highlight: the pattern doesn’t use it'])
  })

  it('refuses a pattern there isn’t, content a pattern needs, a frame that isn’t empty and an SVG photo, changing nothing', async () => {
    const { agent, sync } = await opened()
    const before = stored(sync)
    const size = [{ width: 1080, height: 1080 }]
    const refusals = [
      [{ pattern: 'nope', style: 'bold', sizes: size, content: WORDS }, 'list_patterns'],
      [{ pattern: 'big-number', style: 'bold', sizes: size, content: WORDS }, 'needs number'],
      [{ pattern: 'words-only', style: 'bold', frame: 'sq', content: WORDS }, 'isn’t empty'],
      [{ pattern: 'split', style: 'bold', sizes: size, content: { ...WORDS, photo: 'asset-card' } }, 'SVG file'],
      [{ pattern: 'words-only', style: 'bold', content: WORDS }, 'Give the sizes'],
    ] as const
    for (const [args, says] of refusals) {
      const result = await agent.call('apply_pattern', { ...args })
      expect(result.isError).toBe(true)
      expect(textOf(result)).toContain(says)
    }
    expect(stored(sync)).toEqual(before)
  })
})
