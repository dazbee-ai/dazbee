// Safe zones: the parts of an ad that a platform's own interface covers (its profile, caption,
// buttons and call to action), as each platform publishes them for one aspect ratio. Only a figure
// with a first-party source is kept, with the page or file it comes from and the day it was read.
// The editor shows the 9:16 ones (`SAFE_ZONES`); agents read every ratio's in the ad rules.
import type { Rect } from './primitives.ts'

/** A platform's own page or file a figure is read from. */
export interface PlatformSource {
  url: string
  /** When it was read: a day, YYYY-MM-DD, or `by` and a day when only the latest day it was read by is known. */
  read: string
}

/** How deep something reaches in from each edge of a frame. */
export interface Edges {
  top: number
  bottom: number
  left: number
  right: number
}

/**
 * What one platform's interface covers on a frame of one aspect ratio: along each edge, as a share of
 * the frame's height (top, bottom) or width (sides), and past the edges in `notches`.
 */
export interface SafeZone extends Edges {
  platform: string
  /** The placements the figures are published for. */
  placements: string
  /** The frame the figures are published on, whose aspect ratio they are for. */
  size: { width: number; height: number }
  /**
   * Parts past the edges the interface also covers, cut into the safe area: x and width as shares of the
   * frame's width, y and height of its height.
   */
  notches: readonly Rect[]
  /** The platform's own pages or files the figures are read from. */
  sources: readonly PlatformSource[]
}

/** What a safe zone covers of a frame, in its pixels: how deep along each edge, and its notches. */
export interface CoveredParts extends Edges {
  notches: Rect[]
}

/** The choice of safe zones that shows every platform's together, where another choice names one platform. */
export const ALL_PLATFORMS = 'all'

/** Google's universal video ad safe zones, for every ratio they are published for. */
const YOUTUBE_SOURCES: readonly PlatformSource[] = [
  { url: 'https://support.google.com/google-ads/answer/13547298', read: '2026-11-21' },
  { url: 'https://services.google.com/fh/files/misc/universalsafezones-youtube.pdf', read: '2026-11-21' },
]

/** The 9:16 safe zones the editor shows: one for each platform that publishes its figures itself. */
export const SAFE_ZONES = [
  {
    platform: 'Meta',
    placements: 'Facebook Stories, Instagram Stories and Instagram Reels',
    size: { width: 1440, height: 2560 },
    // "Consider leaving roughly 14% of the top, 35% of the bottom and 6% on each side of your asset free
    // from text, logos or other key creative elements" (each page, 9:16 at 1440 × 2560).
    top: 0.14,
    bottom: 0.35,
    left: 0.06,
    right: 0.06,
    notches: [],
    sources: [
      { url: 'https://www.facebook.com/business/ads-guide/update/image/instagram-reels', read: '2026-11-21' },
      { url: 'https://www.facebook.com/business/ads-guide/update/image/instagram-story', read: '2026-11-21' },
      { url: 'https://www.facebook.com/business/ads-guide/update/image/facebook-story', read: '2026-11-21' },
    ],
  },
  {
    platform: 'YouTube',
    placements: 'Vertical video ads, Shorts among them, on phones, TV, desktop and tablet',
    size: { width: 1080, height: 1920 },
    // Google's universal video ad safe zones, vertical at 1080 × 1920: 288 px top, 672 px bottom, 48 px
    // left, 192 px right.
    top: 288 / 1920,
    bottom: 672 / 1920,
    left: 48 / 1080,
    right: 192 / 1080,
    notches: [],
    sources: YOUTUBE_SOURCES,
  },
  {
    platform: 'TikTok',
    placements: 'In-Feed ads, in the same full-screen feed as posts',
    size: { width: 720, height: 1280 },
    // TikTok's In-Feed safe zone template, on a 720 × 1280 frame: 160 px top (the Following and For You
    // tabs and search), 440 px bottom (username, caption and sound), 80 px each side. Its button column
    // is not printed in the template, so it is left out. Read by 2026-11-19; TikTok's figures for other
    // ratios are not read, so none are here.
    top: 160 / 1280,
    bottom: 440 / 1280,
    left: 80 / 720,
    right: 80 / 720,
    notches: [],
    sources: [
      { url: 'https://ads.tiktok.com/help/article/tiktok-auction-in-feed-ads?lang=en', read: 'by 2026-11-19' },
      {
        url: 'https://lf-tt4b.tiktokcdn.com/obj/i18nblog/tt4b_cms/en-US/5jqet0ab9qci-10e7f5Vig4uhAscNP8XPB0.zip',
        read: 'by 2026-11-19',
      },
    ],
  },
] as const satisfies readonly SafeZone[]

/** The safe zones published for ratios other than 9:16, which the editor doesn't show. */
export const SAFE_ZONES_OF_OTHER_RATIOS: readonly SafeZone[] = [
  {
    platform: 'YouTube',
    placements: 'Square video ads, on phones, TV, desktop and tablet',
    size: { width: 1080, height: 1080 },
    // Google's universal video ad safe zones, square at 1080 × 1080: 48 px top, 390 px bottom, 48 px
    // left, 192 px right, and 105 px deep over the right 546 px of the top.
    top: 48 / 1080,
    bottom: 390 / 1080,
    left: 48 / 1080,
    right: 192 / 1080,
    notches: [{ x: (1080 - 546) / 1080, y: 0, width: 546 / 1080, height: 105 / 1080 }],
    sources: YOUTUBE_SOURCES,
  },
  {
    platform: 'YouTube',
    placements: 'Horizontal (16:9) video ads, on TV, phones, desktop and tablet',
    size: { width: 1920, height: 1080 },
    // Google's universal video ad safe zones, horizontal at 1920 × 1080: 38 px top and left, 152 px
    // right and 143 px bottom; 166 px deep over the left 352 px of the top and 133 px over its right
    // 433 px; along the bottom, 337 px deep from the left edge to 856 px, 190 px from 658 px to 463 px
    // before the right edge, and 309 px over the last 463 px.
    top: 38 / 1080,
    bottom: 143 / 1080,
    left: 38 / 1920,
    right: 152 / 1920,
    notches: [
      { x: 0, y: 0, width: 352 / 1920, height: 166 / 1080 },
      { x: (1920 - 433) / 1920, y: 0, width: 433 / 1920, height: 133 / 1080 },
      { x: 0, y: (1080 - 337) / 1080, width: 856 / 1920, height: 337 / 1080 },
      { x: (1920 - 658) / 1920, y: (1080 - 190) / 1080, width: (658 - 463) / 1920, height: 190 / 1080 },
      { x: (1920 - 463) / 1920, y: (1080 - 309) / 1080, width: 463 / 1920, height: 309 / 1080 },
    ],
    sources: YOUTUBE_SOURCES,
  },
]

/** Which safe zones to show: one platform's, by its name in `SAFE_ZONES`, or every platform's together. */
export type SafeZoneChoice = (typeof SAFE_ZONES)[number]['platform'] | typeof ALL_PLATFORMS

/** How far a frame's width over its height may be from a safe zone's and still take it: 750 × 1334 is 9:16. */
const RATIO_SLACK = 0.005
/** Each edge of every 9:16 safe zone together, as deep as the deepest platform's, as a share of the frame's side. */
const UNION: Edges = {
  top: Math.max(...SAFE_ZONES.map((zone) => zone.top)),
  bottom: Math.max(...SAFE_ZONES.map((zone) => zone.bottom)),
  left: Math.max(...SAFE_ZONES.map((zone) => zone.left)),
  right: Math.max(...SAFE_ZONES.map((zone) => zone.right)),
}

/** Whether a frame is 9:16, the ratio the editor shows safe zones on, within a pixel or so. */
export const isNineBySixteen = (width: number, height: number) => sameRatio(width, height, 9, 16)

/** Every platform's safe zone published for this frame's aspect ratio, the 9:16 ones first; none for a ratio with none. */
export function safeZonesOf(width: number, height: number): SafeZone[] {
  return [...SAFE_ZONES, ...SAFE_ZONES_OF_OTHER_RATIOS].filter((zone) =>
    sameRatio(width, height, zone.size.width, zone.size.height),
  )
}

/** What `zone`'s interface covers of a frame `width` × `height`, in the frame's pixels. */
export function safeZoneOver(zone: SafeZone, width: number, height: number): CoveredParts {
  return {
    top: zone.top * height,
    bottom: zone.bottom * height,
    left: zone.left * width,
    right: zone.right * width,
    notches: zone.notches.map((notch) => ({
      x: notch.x * width,
      y: notch.y * height,
      width: notch.width * width,
      height: notch.height * height,
    })),
  }
}

/**
 * The bands of a 9:16 frame that a platform's interface covers, in the frame's pixels: given a
 * platform's name in `SAFE_ZONES`, that platform's alone; given `ALL_PLATFORMS`, the union of every
 * safe zone's, so each edge as deep as the deepest platform's. Top and bottom run the frame's width,
 * the sides between them. None for a frame of another shape.
 */
export function safeZoneBands(width: number, height: number, platform: SafeZoneChoice): Rect[] {
  const zone = platform === ALL_PLATFORMS ? UNION : SAFE_ZONES.find((each) => each.platform === platform)
  if (!zone || !isNineBySixteen(width, height)) return []
  return edgeBands(zone, width, height)
}

/** Whether a frame's width over its height is `ratioWidth` over `ratioHeight`, within `RATIO_SLACK`. */
function sameRatio(width: number, height: number, ratioWidth: number, ratioHeight: number): boolean {
  return width > 0 && height > 0 && Math.abs(width / height - ratioWidth / ratioHeight) < RATIO_SLACK
}

/** The top and bottom bands across a frame, then its sides between them, each edge's depth a share of the frame. */
function edgeBands(edges: Edges, width: number, height: number): Rect[] {
  const top = edges.top * height
  const bottom = edges.bottom * height
  const left = edges.left * width
  const right = edges.right * width
  const middle = height - top - bottom
  return [
    { x: 0, y: 0, width, height: top },
    { x: 0, y: height - bottom, width, height: bottom },
    { x: 0, y: top, width: left, height: middle },
    { x: width - right, y: top, width: right, height: middle },
  ]
}
