import { afterEach, describe, expect, it } from 'vitest'

import { GOOGLE_FONTS } from '@dazbee/fonts/google'
import { SIZE_CHANNELS, SIZE_PRESETS } from '@dazbee/schema'

import { AD_KINDS } from '../ad-kinds.ts'
import { CHECK } from '../plans.ts'
import { type TestServer, testServer, textOf } from '../test-client.ts'

let server: TestServer

afterEach(async () => {
  await server.endpoint.close()
})

/** A platform's page or file a figure is read from, as an answer gives it. */
interface Source {
  url: string
  read: string
}

/** An area an interface covers, in the frame's pixels. */
interface Area {
  x: number
  y: number
  width: number
  height: number
}

/** A platform's interface over the ad, as ad_rules gives it. */
interface KeepClear {
  platform: string
  placements: string
  edges: { top: number; bottom: number; left: number; right: number }
  notches: Area[]
  sources: Source[]
}

/** A font as ad_rules pairs it. */
interface PairedFont {
  family: string
  weight: number
}

/** The ad rules for one size. */
interface SizeRules {
  size: string
  offered: string[]
  text: { smallest: number; body: number; headline: number }
  margin: number
  keepClear: KeepClear[]
  say: string
  facts: { says: string; sources: Source[] }[]
  fonts: { heading: PairedFont; body: PairedFont; suits: string }[]
  kind?: { name: string; lead: string }
  patterns: string
  textEffects: string
  truth: string
  plans: string
  advice: string
  plan?: string
}

/** The ad rules for a channel. */
interface ChannelRules {
  channel: string
  sizes: (Omit<SizeRules, 'facts' | 'fonts' | 'truth' | 'plans' | 'advice' | 'offered'> & { name: string })[]
  facts: { says: string; sources: Source[] }[]
  fonts: SizeRules['fonts']
  truth: string
  advice: string
}

/** A client of a new access, connected to a new server. */
async function agentOf(options?: Parameters<TestServer['api']['addAccess']>[0]) {
  server = testServer()
  return server.connect(server.api.addAccess(options).token())
}

/** Every platform source anywhere in an answer. */
function sourcesIn(value: unknown): Source[] {
  if (Array.isArray(value)) return value.flatMap(sourcesIn)
  if (typeof value !== 'object' || value === null) return []
  const own = Object.hasOwn(value, 'sources') ? (Reflect.get(value, 'sources') as Source[]) : []
  return [...own, ...Object.values(value).flatMap(sourcesIn)]
}

/** Whether Google Fonts has the family in the weight. */
function googleHas({ family, weight }: PairedFont): boolean {
  const google = GOOGLE_FONTS.find((each) => each.family === family)
  if (!google) return false
  const axis = google.axes.find(({ tag }) => tag === 'wght')
  if (axis) return axis.min <= weight && weight <= axis.max
  return google.faces.some((face) => face.weight === weight)
}

describe('list_fonts', () => {
  it('lists the brand’s own fonts first, then the catalog’s most used, with each style’s weights', async () => {
    const agent = await agentOf()
    expect(await agent.json('list_fonts', { brand: 'brand-summer' })).toEqual({
      families: [
        { family: 'Brand Serif', category: null, own: true, styles: { normal: '400, 700' } },
        { family: 'Inter', category: 'sans-serif', styles: { normal: '100–900', italic: '100–900' } },
        { family: 'Playfair Display', category: 'serif', styles: { normal: '400–900', italic: '400–900' } },
        { family: 'Bebas Neue', category: 'display', styles: { normal: '400' } },
      ],
      more: 0,
    })
  })

  it('keeps those whose name holds the query, in any case, and those of a category', async () => {
    const agent = await agentOf()
    const found = (await agent.json('list_fonts', { brand: 'brand-summer', query: 'PLAY' })) as {
      families: { family: string }[]
    }
    expect(found.families.map(({ family }) => family)).toEqual(['Playfair Display'])
    const display = (await agent.json('list_fonts', { brand: 'brand-summer', category: 'display' })) as {
      families: { family: string }[]
    }
    expect(display.families.map(({ family }) => family)).toEqual(['Bebas Neue'])
  })

  it('refuses a category there is none of, and tells a brand outside the access as the API’s refusal', async () => {
    const agent = await agentOf({ brandIds: ['brand-winter'] })
    const category = await agent.call('list_fonts', { brand: 'brand-winter', category: 'script' })
    expect(category.isError).toBe(true)
    expect(textOf(category)).toMatch(/^`category`: /)
    const outside = await agent.call('list_fonts', { brand: 'brand-summer' })
    expect(outside.isError).toBe(true)
    expect(textOf(outside)).toBe('No such brand.')
  })
})

describe('ad_rules', () => {
  it('advises a 1080×1920 story: text from 33 px, and where Meta’s, YouTube’s and TikTok’s interfaces cover it', async () => {
    const agent = await agentOf()
    const rules = (await agent.json('ad_rules', { size: '1080x1920' })) as SizeRules
    expect(rules.size).toBe('1080x1920')
    expect(rules.offered).toEqual(['meta: story', 'tiktok-youtube: tiktok-video', 'tiktok-youtube: youtube-shorts'])
    expect(rules.text).toEqual({ smallest: 33, body: 50, headline: 99 })
    expect(rules.margin).toBe(65)
    expect(rules.keepClear.map(({ platform }) => platform)).toEqual(['Meta', 'YouTube', 'TikTok'])
    expect(rules.keepClear[0]?.edges).toEqual({ top: 269, bottom: 672, left: 65, right: 65 })
    expect(rules.keepClear[1]?.edges).toEqual({ top: 288, bottom: 672, left: 48, right: 192 })
    expect(rules.say).toMatch(/middle/)
    expect(rules.facts.map(({ says }) => says).join(' ')).toMatch(/14%/)
  })

  it('advises a 1080×1080 square: YouTube’s edges and corner, and that Meta publishes no safe zone for its feed', async () => {
    const agent = await agentOf()
    const rules = (await agent.json('ad_rules', { size: '1080×1080' })) as SizeRules
    expect(rules.text.smallest).toBe(33)
    expect(rules.keepClear.map(({ platform }) => platform)).toEqual(['YouTube'])
    expect(rules.keepClear[0]?.edges).toEqual({ top: 48, bottom: 390, left: 48, right: 192 })
    expect(rules.keepClear[0]?.notches).toEqual([{ x: 534, y: 0, width: 546, height: 105 }])
    const feed = rules.facts.find(({ sources }) => sources.some(({ url }) => url.endsWith('/facebook-feed')))
    expect(feed?.says).toMatch(/no safe zone/i)
  })

  it('advises a 1200×628 link image: text from 37 px, and no platform covering it', async () => {
    const agent = await agentOf()
    const rules = (await agent.json('ad_rules', { size: '1200x628' })) as SizeRules
    expect(rules.offered).toEqual(['linkedin-x: link-image'])
    expect(rules.text).toEqual({ smallest: 37, body: 55, headline: 110 })
    expect(rules.margin).toBe(38)
    expect(rules.keepClear).toEqual([])
    expect(rules.facts.map(({ says }) => says).join(' ')).toMatch(/1200 × 628/)
  })

  it('advises a 300×250 banner at its own pixels: text from 11 px, and the AdChoices icon’s top-right corner', async () => {
    const agent = await agentOf()
    const rules = (await agent.json('ad_rules', { size: '300x250' })) as SizeRules
    expect(rules.text).toEqual({ smallest: 11, body: 17, headline: 33 })
    expect(rules.margin).toBe(15)
    expect(rules.keepClear.map(({ platform }) => platform)).toEqual(['Google Display'])
    expect(rules.keepClear[0]?.notches).toEqual([{ x: 224, y: 0, width: 76, height: 15 }])
    expect(rules.say).toMatch(/5 words/)
  })

  it('keeps a thin banner’s headline inside its height', async () => {
    const agent = await agentOf()
    const rules = (await agent.json('ad_rules', { size: '320x50' })) as SizeRules
    expect(rules.text).toEqual({ smallest: 11, body: 17, headline: 22 })
    expect(rules.say).toMatch(/one row/)
  })

  it('advises a channel: each of its sizes for its shape, and the channel’s own facts', async () => {
    const agent = await agentOf()
    const google = (await agent.json('ad_rules', { channel: 'google' })) as ChannelRules
    const banners = SIZE_PRESETS.filter((preset) => preset.channel === 'google')
    expect(google.sizes.map(({ name, size }) => `${name} ${size}`)).toEqual(
      banners.map(({ id, width, height }) => `${id} ${width}x${height}`),
    )
    for (const size of google.sizes) {
      expect(size.text.smallest).toBe(11)
      expect(size.keepClear.map(({ platform }) => platform)).toEqual(['Google Display'])
    }
    const meta = (await agent.json('ad_rules', { channel: 'meta' })) as ChannelRules
    const story = meta.sizes.find(({ name }) => name === 'story')
    expect(story?.keepClear.map(({ platform }) => platform)).toEqual(['Meta'])
    expect(meta.sizes.find(({ name }) => name === 'feed-square')?.keepClear).toEqual([])
    expect(meta.facts.length).toBeGreaterThan(0)
    const video = (await agent.json('ad_rules', { channel: 'tiktok-youtube' })) as ChannelRules
    expect(video.sizes.map(({ name, keepClear }) => [name, keepClear.map(({ platform }) => platform)])).toEqual([
      ['tiktok-video', ['TikTok']],
      ['youtube-thumbnail', []],
      ['youtube-shorts', ['YouTube']],
    ])
  })

  it('names the source and the day read of every platform figure, for every channel and every offered size', async () => {
    const agent = await agentOf()
    const answers = [
      ...(await Promise.all(SIZE_CHANNELS.map((channel) => agent.json('ad_rules', { channel })))),
      ...(await Promise.all(
        SIZE_PRESETS.map(({ width, height }) => agent.json('ad_rules', { size: `${width}x${height}` })),
      )),
    ] as (SizeRules | ChannelRules)[]
    for (const answer of answers) {
      for (const figure of [...answer.facts, ...('keepClear' in answer ? answer.keepClear : [])])
        expect(figure.sources.length).toBeGreaterThan(0)
      for (const source of sourcesIn(answer)) {
        expect(source.url).toMatch(/^https:\/\//)
        expect(source.read).toMatch(/^(by )?\d{4}-\d{2}-\d{2}$/)
      }
    }
  })

  it('says it is advice, and that facts are never made up', async () => {
    const agent = await agentOf()
    const rules = (await agent.json('ad_rules', { size: '1080x1350' })) as SizeRules
    expect(rules.advice).toMatch(/never a limit/)
    expect(rules.truth).toMatch(/never invent/i)
    expect(rules.plans).toMatch(/make_ad/)
  })

  it('says to use a pattern only where it fits the brief, and to design from scratch for a distinctive one', async () => {
    const agent = await agentOf()
    const rules = (await agent.json('ad_rules', { size: '1080x1080' })) as SizeRules
    expect(rules.patterns).toMatch(/only where it fits the brief/)
    expect(rules.patterns).toMatch(/design from scratch/)
    const plan = (await agent.json('ad_rules', { plan: 'make_ad' })) as { plan: string }
    expect(plan.plan).toMatch(/Where a pattern fits the brief.*design it from scratch/s)
  })

  it('says when a curve suits an ad, and that body copy is never curved', async () => {
    const agent = await agentOf()
    const rules = (await agent.json('ad_rules', { size: '1080x1080' })) as SizeRules
    expect(rules.textEffects).toMatch(/badge.*stamp.*round product.*playful offer/s)
    expect(rules.textEffects).toMatch(/never body copy/)
  })

  it('advises a kind of ad, with font pairings Google Fonts has in the weights named', async () => {
    const agent = await agentOf()
    const plain = (await agent.json('ad_rules', { size: '1080x1080' })) as SizeRules
    expect(plain.kind).toBeUndefined()
    const sale = (await agent.json('ad_rules', { size: '1080x1080', kind: 'sale' })) as SizeRules
    expect(sale.kind?.name).toBe('sale')
    expect(sale.kind?.lead.length).toBeGreaterThan(40)
    expect(sale.fonts).not.toEqual(plain.fonts)
    for (const kind of AD_KINDS) {
      const rules = (await agent.json('ad_rules', { size: '300x250', kind })) as SizeRules
      expect(rules.fonts.length).toBeGreaterThan(0)
      for (const { heading, body } of rules.fonts) {
        expect(googleHas(heading), `${kind}: ${heading.family} ${heading.weight}`).toBe(true)
        expect(googleHas(body), `${kind}: ${body.family} ${body.weight}`).toBe(true)
      }
    }
  })

  it('answers a plan in full, ending with the check, alone or with a size', async () => {
    const agent = await agentOf()
    const alone = (await agent.json('ad_rules', { plan: 'make_ad' })) as { plan: string }
    expect(alone.plan).toContain('create_design')
    expect(alone.plan.endsWith(CHECK)).toBe(true)
    const withSize = (await agent.json('ad_rules', { size: '1080x1080', plan: 'review_frames' })) as SizeRules
    expect(withSize.plan).toContain('check_frame')
    expect(withSize.text.smallest).toBe(33)
  })

  it('refuses a size and a channel together, neither, and a size it can’t read or a frame can’t be', async () => {
    const agent = await agentOf()
    const both = await agent.call('ad_rules', { size: '1080x1080', channel: 'meta' })
    expect(both.isError).toBe(true)
    expect(textOf(both)).toMatch(/size or a channel, not both/)
    const neither = await agent.call('ad_rules', { kind: 'sale' })
    expect(neither.isError).toBe(true)
    expect(textOf(neither)).toMatch(/size, a channel or a plan/)
    const words = await agent.call('ad_rules', { size: 'story' })
    expect(words.isError).toBe(true)
    expect(textOf(words)).toMatch(/`size`/)
    const huge = await agent.call('ad_rules', { size: '9000x9000' })
    expect(huge.isError).toBe(true)
    expect(textOf(huge)).toMatch(/at most 8000 px/)
  })
})
