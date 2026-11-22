// The ad rules: advice an agent reads for one size or channel before it designs. A platform's figure names the
// platform's own page or file and the day it was read; the rest is Dazbee's own advice. Advice only: nothing in
// Dazbee reads these to refuse, change or warn about a design.
import {
  type Edges,
  type PlatformSource,
  readableTextSize,
  type Rect,
  SAFE_ZONES,
  type SafeZone,
  safeZoneOver,
  safeZonesOf,
  shapeOf,
  SIZE_PRESETS,
  type SizeChannel,
  type SizePreset,
} from '@dazbee/schema'

import { type AdKind, type FontPairing, kindAdvice } from './ad-kinds.ts'
import { PLANS } from './plans.ts'

/** What a platform publishes, with its own pages or files. */
interface PlatformFact {
  says: string
  sources: readonly PlatformSource[]
}

/** A platform's interface over a frame: how deep along each edge, and its notches, in the frame's whole pixels. */
interface KeepClear {
  platform: string
  placements: string
  edges: Edges
  notches: Rect[]
  sources: readonly PlatformSource[]
}

/** The advice for one size: its text sizes and margin in its own pixels, what covers it, and how much to say. */
interface SizeAdvice {
  size: string
  /** The smallest text that reads, and the least a body text and a headline should be, in the frame's pixels. */
  text: { smallest: number; body: number; headline: number }
  shown: string
  margin: number
  keepClear: KeepClear[]
  say: string
}

/**
 * What every answer of the ad rules carries besides its sizes: the kind's advice, fonts, when to use a pattern, the
 * truth rule, the plans and that it is advice.
 */
interface SharedRules {
  kind?: { name: AdKind; lead: string }
  fonts: FontPairing[]
  patterns: string
  illustrations: string
  truth: string
  plans: string
  advice: string
}

/** The ad rules for one size. */
export interface SizeRules extends SizeAdvice, SharedRules {
  /** The channels that offer the size, each as `channel: size name`. */
  offered: string[]
  facts: PlatformFact[]
}

/** The ad rules for a channel: each of its sizes' advice, and its platforms' facts. */
export interface ChannelRules extends SharedRules {
  channel: SizeChannel
  name: string
  sizes: (SizeAdvice & { name: string })[]
  facts: PlatformFact[]
}

/** The platform the AdChoices icon belongs to, among those whose interface covers an ad. */
const GOOGLE_DISPLAY = 'Google Display'
/** The day the platforms' pages below were read. */
const READ = '2026-11-21'
/** A platform's page or file, read on `READ`. */
const page = (url: string): PlatformSource => ({ url, read: READ })
/** The 9:16 safe zone of a platform in `SAFE_ZONES`. */
const nineBySixteen = (platform: (typeof SAFE_ZONES)[number]['platform']): SafeZone =>
  SAFE_ZONES.find((zone) => zone.platform === platform) ?? SAFE_ZONES[0]
/** `share` as a whole percentage. */
const percent = (share: number) => `${Math.round(share * 100)}%`

const META = nineBySixteen('Meta')
const YOUTUBE = nineBySixteen('YouTube')
const TIKTOK = nineBySixteen('TikTok')
const META_FEED = [
  page('https://www.facebook.com/business/ads-guide/update/image/facebook-feed'),
  page('https://www.facebook.com/business/ads-guide/update/image/instagram-feed'),
]
const LINKEDIN_IMAGE = [page('https://www.linkedin.com/help/lms/answer/a426534')]
const PINTEREST_SPECS = [page('https://help.pinterest.com/en/business/article/pinterest-product-specs')]
const ADCHOICES = [
  page('https://support.google.com/admanager/answer/2695279?hl=en'),
  page('https://support.google.com/adspolicy/answer/94230?hl=en'),
]
/** The AdChoices icon opened, in a banner's pixels. */
const ADCHOICES_SIZE = { width: 76, height: 15 }

/** Each channel's name. */
const CHANNEL_NAMES: Record<SizeChannel, string> = {
  meta: 'Meta: Facebook and Instagram',
  'tiktok-youtube': 'TikTok and YouTube',
  'linkedin-x': 'LinkedIn and X: LinkedIn’s sizes, until X’s are verified',
  pinterest: 'Pinterest',
  google: GOOGLE_DISPLAY,
}

/** The platforms whose interface covers an offered size where it runs, by its name; none for the rest. */
const PLACED_ON: Partial<Record<SizePreset['id'], readonly string[]>> = {
  story: [META.platform],
  'tiktok-video': [TIKTOK.platform],
  'youtube-shorts': [YOUTUBE.platform],
}

/** What each channel's platforms publish about their ads. */
const CHANNEL_FACTS: Record<SizeChannel, PlatformFact[]> = {
  meta: [
    {
      says: 'Facebook and Instagram feeds: image ads at 4:5, 1440 × 1800 recommended (1080 × 1350 is 4:5). Meta publishes no safe zone for its feeds.',
      sources: META_FEED,
    },
    {
      says: `Facebook and Instagram Stories and Instagram Reels: 9:16, ${META.size.width} × ${META.size.height} recommended; leave roughly ${percent(META.top)} of the top, ${percent(META.bottom)} of the bottom and ${percent(META.left)} of each side free of text, logos and other key elements.`,
      sources: META.sources,
    },
    {
      says: 'The text Meta shows with the ad: primary text of 125 characters (Instagram feed and Stories, Facebook Stories), 50–150 (Facebook feed) or 44 (Instagram Reels), and a headline of 27 characters (Facebook feed) or 40 (Instagram feed).',
      sources: [...META_FEED, ...META.sources],
    },
  ],
  'tiktok-youtube': [
    {
      says: 'YouTube video ads, in every format and on every screen: keep the logo, product and words inside Google’s universal safe zones, published for vertical (1080 × 1920), square (1080 × 1080) and horizontal (1920 × 1080) frames.',
      sources: YOUTUBE.sources,
    },
    {
      says: 'YouTube custom thumbnails: 16:9 for videos and 9:16 for Shorts, at least 640 px wide for videos and 640 px tall for Shorts.',
      sources: [page('https://support.google.com/youtube/answer/72431?hl=en')],
    },
    {
      says: `TikTok In-Feed ads: 9:16; on a ${TIKTOK.size.width} × ${TIKTOK.size.height} frame keep text and the logo out of the top ${TIKTOK.top * TIKTOK.size.height} px, the bottom ${TIKTOK.bottom * TIKTOK.size.height} px and ${TIKTOK.left * TIKTOK.size.width} px of each side. Read by 2026-11-19; TikTok’s other figures are not read, so none are given.`,
      sources: TIKTOK.sources,
    },
  ],
  'linkedin-x': [
    {
      says: 'LinkedIn single image ads, at its recommended dimensions: 1.91:1 at 1200 × 628 and 4:5 at 720 × 900 (its recommended ratios), and 1:1 at 1200 × 1200. LinkedIn recommends vertical ratios, which show on phones only; square and vertical images might be cropped when the ad is shared organically. LinkedIn publishes no safe zone.',
      sources: LINKEDIN_IMAGE,
    },
    {
      says: 'The text LinkedIn shows with the ad: introductory text of up to 150 characters to avoid truncation.',
      sources: LINKEDIN_IMAGE,
    },
  ],
  pinterest: [
    {
      says: 'Pinterest standard image ads: 2:3, 1000 × 1500 recommended; a pin taller than 2:3 might get cut off in feeds. Pinterest publishes no safe zone for image ads.',
      sources: PINTEREST_SPECS,
    },
    {
      says: 'The title Pinterest shows with the ad: up to 100 characters, of which only the first 40 may show in feeds.',
      sources: PINTEREST_SPECS,
    },
  ],
  google: [
    {
      says: 'The display sizes Google calls top performing: 300 × 250, 336 × 280, 728 × 90, 300 × 600 and 320 × 100; 320 × 50, 160 × 600 and 970 × 250 are supported too.',
      sources: [page('https://support.google.com/adsense/answer/6002621')],
    },
    {
      says: `Google shows its AdChoices icon in the top-right corner of a display ad: 19 × 15 px, opening to ${ADCHOICES_SIZE.width} × ${ADCHOICES_SIZE.height} px.`,
      sources: ADCHOICES,
    },
  ],
}

/** The rule against making facts up. */
const TRUTH =
  'Never invent facts: a price, discount, date, place, number, name, claim, review or quote goes in the ad only as the person gave it or the brand’s own pages show it. Where a plan or a layout wants one you weren’t given, leave it out or ask.'
/** When an agent builds from a pattern, and when it designs from scratch. */
const PATTERNS_LINE =
  'Patterns (list_patterns, apply_pattern) are a starting point, never the ad: use one only where it fits the brief, then make its draft the brand’s own (apply_pattern suggests how). Where none fits, or the brief asks for something distinctive, design from scratch.'
/** How an agent uses the bundled illustrations. */
const ILLUSTRATIONS_LINE =
  'An illustration (search_graphics kind illustration) shows a scene where no photo fits: keep to one illustration set in a design, give it room as the ad’s picture rather than a corner, and keep its own colours unless an accent in a brand colour suits the ad better.'
/** Where an agent finds the plans. */
const PLANS_LINE = `ad_rules with \`plan\` gives a plan’s steps: ${PLANS.map(({ name, title }) => `${name} (${title.toLowerCase()})`).join(', ')}.`
/** That the ad rules are advice, and how to read keepClear for a size. */
const ADVICE =
  'Advice, never a limit: Dazbee keeps and draws a design that ignores it. Break a rule on purpose when the person asks, or when the ad is better for it. keepClear names each platform and placement it is for: keep clear of those the ad runs in.'
/** A frame's margin, as a share of its shorter side, and as a share of its smallest readable text. */
const MARGIN_SHARE = 0.06
const MARGIN_TEXT_SHARE = 0.75
/** How far a headline may fill a frame's shorter side. */
const HEADLINE_SHARE = 0.45
/** The shorter side, in pixels, up to which a banner takes its parts in one row. */
const ONE_ROW_SIDE = 100

/**
 * The ad rules for a frame `width` × `height`, and for `kind` of ad when given. A size alone doesn't say where it
 * runs, so every platform's interface published for its aspect ratio is given, each with its placements.
 */
export function sizeRules(width: number, height: number, kind?: AdKind): SizeRules {
  const offers = SIZE_PRESETS.filter((preset) => preset.width === width && preset.height === height)
  const channels = [...new Set(offers.map((preset) => preset.channel))]
  return {
    ...sizeAdvice(width, height),
    offered: offers.map((preset) => `${preset.channel}: ${preset.id}`),
    facts: channels.flatMap((channel) => CHANNEL_FACTS[channel]),
    ...sharedRules(kind),
  }
}

/** The ad rules for `channel`: each size it offers, with the interfaces of the platforms it runs on there. */
export function channelRules(channel: SizeChannel, kind?: AdKind): ChannelRules {
  return {
    channel,
    name: CHANNEL_NAMES[channel],
    sizes: SIZE_PRESETS.filter((preset) => preset.channel === channel).map((preset) => ({
      name: preset.id,
      ...sizeAdvice(preset.width, preset.height, placedOn(preset)),
    })),
    facts: CHANNEL_FACTS[channel],
    ...sharedRules(kind),
  }
}

/** A size's advice, with the interfaces of `platforms` over it, or of every platform when none are named. */
function sizeAdvice(width: number, height: number, platforms?: readonly string[]): SizeAdvice {
  const smallest = readableTextSize(width, height)
  const shorter = Math.min(width, height)
  const body = wholeUp(smallest * 1.5)
  const banner = isBanner(width, height)
  const zones = safeZonesOf(width, height).filter((zone) => !platforms || platforms.includes(zone.platform))
  const adChoices = banner && (!platforms || platforms.includes(GOOGLE_DISPLAY)) ? [adChoicesOf(width)] : []
  return {
    size: `${width}x${height}`,
    text: {
      smallest: wholeUp(smallest),
      body,
      headline: Math.max(body, Math.min(wholeUp(smallest * 3), Math.floor(shorter * HEADLINE_SHARE))),
    },
    shown: banner
      ? 'A display banner, shown at its own pixels: text under text.smallest is too small to read, and check_frame warns of it.'
      : `Shown fitted to a phone’s width (360 CSS px), so ${round(width / 360)} of the frame’s px make one there: text under text.smallest is too small to read, and check_frame warns of it.`,
    margin: Math.max(Math.round(shorter * MARGIN_SHARE), wholeUp(smallest * MARGIN_TEXT_SHARE)),
    keepClear: [...zones.map((zone) => keepClearOf(zone, width, height)), ...adChoices],
    say: sayFor(width, height, banner),
  }
}

/** The kind's advice and fonts, when to use a pattern, the truth rule, the plans and that the rules are advice. */
function sharedRules(kind?: AdKind): SharedRules {
  return {
    ...kindAdvice(kind),
    patterns: PATTERNS_LINE,
    illustrations: ILLUSTRATIONS_LINE,
    truth: TRUTH,
    plans: PLANS_LINE,
    advice: ADVICE,
  }
}

/** The platforms whose interface covers an offered size where its channel runs it. */
function placedOn(preset: SizePreset): readonly string[] {
  return preset.channel === 'google' ? [GOOGLE_DISPLAY] : (PLACED_ON[preset.id] ?? [])
}

/** `value` rounded up to a whole number, a hair's floating-point error left out. */
function wholeUp(value: number): number {
  return Math.ceil(value - 1e-9)
}

/** Whether a frame is a size of the Google Display channel, which shows at its own pixels. */
function isBanner(width: number, height: number): boolean {
  return SIZE_PRESETS.some(
    (preset) => preset.channel === 'google' && preset.width === width && preset.height === height,
  )
}

/** The AdChoices icon's corner of a banner `width` wide, opened. */
function adChoicesOf(width: number): KeepClear {
  return {
    platform: GOOGLE_DISPLAY,
    placements: 'The AdChoices icon on display ads',
    edges: { top: 0, bottom: 0, left: 0, right: 0 },
    notches: [{ x: width - ADCHOICES_SIZE.width, y: 0, ...ADCHOICES_SIZE }],
    sources: ADCHOICES,
  }
}

/** `value` to two decimals. */
function round(value: number): number {
  return Math.round(value * 100) / 100
}

/** A safe zone over a frame `width` × `height`, in whole pixels. */
function keepClearOf(zone: SafeZone, width: number, height: number): KeepClear {
  const { notches, top, bottom, left, right } = safeZoneOver(zone, width, height)
  return {
    platform: zone.platform,
    placements: zone.placements,
    edges: { top: Math.round(top), bottom: Math.round(bottom), left: Math.round(left), right: Math.round(right) },
    notches: notches.map(wholePixels),
    sources: zone.sources,
  }
}

/** How much a frame of this size should say. */
function sayFor(width: number, height: number, banner: boolean): string {
  if (banner && Math.min(width, height) <= ONE_ROW_SIDE)
    return 'A banner seen in passing, in one row: the logo, a headline of up to 5 words and a button of 1–3 words side by side, and no subline.'
  if (banner)
    return 'A banner seen in passing beside other content: a headline of up to 5 words, a subline of up to 8 words only where it fits, a button of 1–3 words and the logo.'
  if (shapeOf(width, height) === 'tall')
    return 'Full screen on a phone, the platform’s caption and buttons over its bottom: a headline of up to 7 words in the clear middle, a subline of up to 12 words, a button of 1–3 words above the covered bottom and the logo inside the clear top. One idea; the caption says the rest.'
  return 'Seen in a feed or beside content, the platform’s own text next to it: a headline of up to 7 words, a subline of up to 12 words, a button of 1–3 words and the logo. One idea; the text beside the ad says the rest.'
}

/** An area in whole pixels. */
function wholePixels(area: Rect): Rect {
  return {
    x: Math.round(area.x),
    y: Math.round(area.y),
    width: Math.round(area.width),
    height: Math.round(area.height),
  }
}
