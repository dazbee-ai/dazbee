// The kit's logo found in the brand's library, with the library's answers stubbed: the values a
// kit gives, and how often the library is asked.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { type AssetSummary, type BrandKit, EMPTY_BRAND_KIT } from '@dazbee/schema'

import { kitLogo, kitVariables, knownAsset, rememberAssets } from './kit-logo.ts'

const asset = (id: string, contentType: AssetSummary['contentType']): AssetSummary => ({
  id,
  brandId: 'brand-1',
  sha256: '0'.repeat(64),
  contentType,
  byteSize: 10,
  width: 10,
  height: 10,
  name: id,
  tags: [],
  createdAt: '2026-11-21T10:00:00.000Z',
})
const kit = (logoAssetId: string | null): BrandKit => ({
  ...EMPTY_BRAND_KIT,
  colors: [{ token: 'primary', name: 'Primary', value: '#14213DFF' }],
  logoAssetId,
})

/** How many times the library was asked. */
let asked: number

beforeEach(() => {
  asked = 0
  const library = [asset('png-logo', 'image/png'), asset('svg-logo', 'image/svg+xml')]
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      asked++
      return new Response(JSON.stringify(library))
    }),
  )
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('rememberAssets', () => {
  it('keeps assets the app has listed, so they are known without asking the library', async () => {
    rememberAssets([asset('uploaded', 'image/webp')])
    expect(await kitVariables('ws', 'brand-1', kit('uploaded'))).toMatchObject({ 'brand:logo': 'uploaded' })
    expect(asked).toBe(0)
  })
})

describe('knownAsset', () => {
  it('gives an asset the app has listed, and none for another id or no id', () => {
    rememberAssets([asset('listed', 'image/jpeg')])
    expect(knownAsset('listed')?.contentType).toBe('image/jpeg')
    expect(knownAsset('never-listed')).toBeUndefined()
    expect(knownAsset(null)).toBeUndefined()
  })
})

describe('kitLogo', () => {
  it('looks the logo up in the library once, then knows it', async () => {
    expect((await kitLogo('ws', 'brand-1', 'svg-logo'))?.contentType).toBe('image/svg+xml')
    expect(knownAsset('svg-logo')?.id).toBe('svg-logo')
    await kitLogo('ws', 'brand-1', 'svg-logo')
    expect(asked).toBe(1)
  })

  it('gives none offline, and asks nothing for no logo', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('offline'))),
    )
    expect(await kitLogo('ws', 'brand-1', 'offline-logo')).toBeUndefined()
    expect(await kitLogo('ws', 'brand-1', null)).toBeUndefined()
  })
})

describe('kitVariables', () => {
  it('gives brand:logo for an image logo of the library', async () => {
    expect(await kitVariables('ws', 'brand-1', kit('png-logo'))).toEqual({
      'brand:primary': '#14213DFF',
      'brand:logo': 'png-logo',
    })
  })

  it('gives no brand:logo for an SVG logo, a logo the library lacks, or a kit without one', async () => {
    expect(await kitVariables('ws', 'brand-1', kit('svg-logo'))).toEqual({ 'brand:primary': '#14213DFF' })
    expect(await kitVariables('ws', 'brand-1', kit('gone'))).toEqual({ 'brand:primary': '#14213DFF' })
    expect(await kitVariables('ws', 'brand-1', kit(null))).toEqual({ 'brand:primary': '#14213DFF' })
  })
})
