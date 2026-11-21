import { describe, expect, it } from 'vitest'

import {
  ALL_PLATFORMS,
  isNineBySixteen,
  SAFE_ZONES,
  SAFE_ZONES_OF_OTHER_RATIOS,
  safeZoneBands,
  type SafeZoneChoice,
  safeZoneOver,
  safeZonesOf,
} from './safe-zones.ts'

describe('SAFE_ZONES', () => {
  it('keeps each platform’s figure with a source on the platform’s own site and the day it was read', () => {
    const own: Record<string, RegExp> = {
      Meta: /^https:\/\/www\.facebook\.com\/business\//,
      YouTube: /^https:\/\/(support|services)\.google\.com\//,
      TikTok: /^https:\/\/(ads\.tiktok\.com|lf-tt4b\.tiktokcdn\.com)\//,
    }
    expect(SAFE_ZONES.map((zone) => zone.platform)).toEqual(['Meta', 'YouTube', 'TikTok'])
    for (const zone of [...SAFE_ZONES, ...SAFE_ZONES_OF_OTHER_RATIOS]) {
      expect(zone.sources.length).toBeGreaterThan(0)
      for (const source of zone.sources) {
        expect(source.url).toMatch(own[zone.platform] ?? /^$/)
        expect(source.read).toMatch(/^(by )?\d{4}-\d{2}-\d{2}$/)
      }
    }
  })
})

describe('isNineBySixteen', () => {
  it('holds for 9:16 frames at any size, and a pixel off, and for no other shape', () => {
    expect([
      isNineBySixteen(1080, 1920),
      isNineBySixteen(1440, 2560),
      isNineBySixteen(750, 1334),
      isNineBySixteen(1080, 1350),
      isNineBySixteen(0, 0),
    ]).toEqual([true, true, true, false, false])
  })
})

describe('safeZonesOf', () => {
  it('gives every platform’s safe zone published for the frame’s shape, at any size, and none for a shape with none', () => {
    const platforms = (width: number, height: number) =>
      safeZonesOf(width, height).map((zone) => `${zone.platform} ${zone.size.width}x${zone.size.height}`)
    expect(platforms(1080, 1920)).toEqual(['Meta 1440x2560', 'YouTube 1080x1920', 'TikTok 720x1280'])
    expect(platforms(1080, 1080)).toEqual(['YouTube 1080x1080'])
    expect(platforms(300, 300)).toEqual(['YouTube 1080x1080'])
    expect(platforms(1920, 1080)).toEqual(['YouTube 1920x1080'])
    expect(platforms(1280, 720)).toEqual(['YouTube 1920x1080'])
    expect(platforms(1080, 1350)).toEqual([])
    expect(platforms(1200, 628)).toEqual([])
  })
})

describe('safeZoneOver', () => {
  it('covers a square frame along YouTube’s edges and its top-right notch, in the frame’s pixels', () => {
    const [youtube] = safeZonesOf(1080, 1080)
    if (!youtube) throw new Error('YouTube publishes a square safe zone')
    expect(safeZoneOver(youtube, 1080, 1080)).toEqual({
      top: 48,
      bottom: 390,
      left: 48,
      right: 192,
      notches: [{ x: 534, y: 0, width: 546, height: 105 }],
    })
    expect(safeZoneOver(youtube, 540, 540).bottom).toBe(195)
  })

  it('covers a 16:9 frame along YouTube’s edges and its stepped notches', () => {
    const [youtube] = safeZonesOf(1920, 1080)
    if (!youtube) throw new Error('YouTube publishes a 16:9 safe zone')
    const { notches, ...edges } = safeZoneOver(youtube, 1920, 1080)
    expect(Object.values(edges).map((n) => Math.round(n))).toEqual([38, 143, 38, 152])
    expect(notches.map((area) => [area.x, area.y, area.width, area.height].map((n) => Math.round(n)))).toEqual([
      [0, 0, 352, 166],
      [1487, 0, 433, 133],
      [0, 743, 856, 337],
      [1262, 890, 195, 190],
      [1457, 771, 463, 309],
    ])
  })

  it('covers a 9:16 frame as deep as safeZoneBands', () => {
    for (const zone of safeZonesOf(1080, 1920)) {
      const [top, bottom, left, right] = safeZoneBands(1080, 1920, zone.platform as SafeZoneChoice)
      const over = safeZoneOver(zone, 1080, 1920)
      expect([over.top, over.bottom, over.left, over.right]).toEqual([
        top?.height,
        bottom?.height,
        left?.width,
        right?.width,
      ])
    }
  })
})

describe('safeZoneBands', () => {
  it('covers a 1080 × 1920 frame as deep as the deepest platform on each edge: YouTube’s top and right, TikTok’s left, Meta’s and YouTube’s bottom', () => {
    // Meta: 14% top (268.8), 35% bottom (672), 6% sides (64.8). YouTube: 288 top, 672 bottom, 48 left, 192 right.
    // TikTok: 160, 440 and 80 of 720 × 1280, so 240 top, 660 bottom, 120 sides.
    const [top, bottom, left, right] = safeZoneBands(1080, 1920, ALL_PLATFORMS)
    expect(top).toEqual({ x: 0, y: 0, width: 1080, height: 288 })
    expect(bottom).toEqual({ x: 0, y: 1248, width: 1080, height: 672 })
    expect(left?.x).toBe(0)
    expect(left?.y).toBe(288)
    expect(left?.width).toBeCloseTo(120)
    expect(left?.height).toBe(960)
    expect(right).toEqual({ x: 888, y: 288, width: 192, height: 960 })
  })

  it('covers a 1080 × 1920 frame with one platform’s figures alone when given its name', () => {
    const rounded = (platform: SafeZoneChoice) =>
      safeZoneBands(1080, 1920, platform).map((band) =>
        [band.x, band.y, band.width, band.height].map((n) => Math.round(n)),
      )
    // Meta: 14% top, 35% bottom, 6% each side.
    expect(rounded('Meta')).toEqual([
      [0, 0, 1080, 269],
      [0, 1248, 1080, 672],
      [0, 269, 65, 979],
      [1015, 269, 65, 979],
    ])
    expect(rounded('YouTube')).toEqual([
      [0, 0, 1080, 288],
      [0, 1248, 1080, 672],
      [0, 288, 48, 960],
      [888, 288, 192, 960],
    ])
    expect(rounded('TikTok')).toEqual([
      [0, 0, 1080, 240],
      [0, 1260, 1080, 660],
      [0, 240, 120, 1020],
      [960, 240, 120, 1020],
    ])
  })

  it('scales with a 9:16 frame of another size, and gives none for another shape', () => {
    expect(safeZoneBands(1440, 2560, ALL_PLATFORMS)[0]).toEqual({ x: 0, y: 0, width: 1440, height: 384 })
    expect(safeZoneBands(1080, 1080, ALL_PLATFORMS)).toEqual([])
  })
})
