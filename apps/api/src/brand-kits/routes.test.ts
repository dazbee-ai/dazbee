// The brand kit routes, against Postgres from Docker Compose (`docker compose up -d --wait postgres`).
import { describe, expect, it } from 'vitest'

import { BrandKit, brandVariables } from '@dazbee/schema'

import { brand, call, run, sibling, uploadImage } from '../test-api.ts'
import { png } from '../test-files.ts'

// Recording the logo makes its thumbnail with CanvasKit, which takes seconds to load on a busy CI runner.
describe('brand kits (#53)', { timeout: 30_000 }, () => {
  const kit = {
    colors: [
      { token: 'primary', name: 'Harbour red', value: '#E0262BFF' },
      { token: 'ink', name: 'Ink', value: '#14213DFF' },
    ],
    fonts: [{ token: 'heading', name: 'Heading', family: 'Playfair Display' }],
    logoAssetId: null,
    voice: 'Warm, short, no jargon.',
    textStyles: [
      {
        token: 'headline',
        name: 'Headline',
        font: { token: 'heading' },
        fontWeight: 700,
        fontStyle: 'normal',
        lineHeight: 1.1,
        letterSpacing: { unit: 'percent', value: -1 },
        textCase: 'upper',
      },
    ],
  }
  /** The kit as a tab built before text styles saves it: without them. */
  const { textStyles, ...before } = kit

  it('starts empty, saves the whole kit and gives its tokens as variables', async () => {
    expect((await call('a', 'GET', `/brands/${sibling.id}/kit`)).json).toEqual({
      colors: [],
      fonts: [],
      logoAssetId: null,
      voice: '',
      textStyles: [],
      updatedAt: null,
    })
    const saved = await call('a', 'PUT', `/brands/${brand.id}/kit`, kit)
    expect(saved).toEqual({ status: 200, json: { ...kit, updatedAt: expect.any(String) } })
    const changed = { ...kit, colors: [{ ...kit.colors[0], value: '#1F9D55FF' }] }
    await call('a', 'PUT', `/brands/${brand.id}/kit`, changed)
    const read = BrandKit.parse((await call('a', 'GET', `/brands/${brand.id}/kit`)).json)
    expect(brandVariables(read)).toEqual({
      'brand:primary': '#1F9D55FF',
      'brand:heading': 'Playfair Display',
      'brand:headline': {
        fontFamily: 'Playfair Display',
        fontWeight: 700,
        fontStyle: 'normal',
        lineHeight: 1.1,
        letterSpacing: { unit: 'percent', value: -1 },
        textCase: 'upper',
      },
    })
  })

  it('keeps the text styles when a tab built before saves the kit without them', async () => {
    await call('a', 'PUT', `/brands/${brand.id}/kit`, kit)
    const saved = await call('a', 'PUT', `/brands/${brand.id}/kit`, { ...before, voice: 'Bold.' })
    expect(saved).toEqual({ status: 200, json: { ...kit, voice: 'Bold.', updatedAt: expect.any(String) } })
    expect((await call('a', 'PUT', `/brands/${sibling.id}/kit`, before)).json).toMatchObject({ textStyles: [] })
    expect((await call('a', 'PUT', `/brands/${brand.id}/kit`, { ...kit, textStyles: [] })).json).toMatchObject({
      textStyles: [],
    })
  })

  it("refuses a save from a tab built before that gives a kept text style's token to a colour", async () => {
    await call('a', 'PUT', `/brands/${brand.id}/kit`, kit)
    const red = { token: 'headline', name: 'Headline', value: '#E0262BFF' }
    const refused = await call('a', 'PUT', `/brands/${brand.id}/kit`, { ...before, colors: [red] })
    expect(refused).toEqual({ status: 400, json: { error: 'the token "headline" names two things' } })
    expect((await call('a', 'GET', `/brands/${brand.id}/kit`)).json).toEqual({ ...kit, updatedAt: expect.any(String) })
  })

  it('never stores two things under one token when a save without text styles meets one with them', async () => {
    const red = { token: 'headline', name: 'Headline', value: '#E0262BFF' }
    for (let round = 0; round < 10; round++) {
      await call('a', 'PUT', `/brands/${sibling.id}/kit`, { ...kit, textStyles: [] })
      await Promise.all([
        call('a', 'PUT', `/brands/${sibling.id}/kit`, { ...before, colors: [red] }),
        call('a', 'PUT', `/brands/${sibling.id}/kit`, kit),
      ])
      const stored = (await call('a', 'GET', `/brands/${sibling.id}/kit`)).json
      expect(BrandKit.safeParse(stored).success).toBe(true)
    }
  })

  it('refuses the second of two saves made from the same kit, and keeps the first', async () => {
    await call('a', 'PUT', `/brands/${brand.id}/kit`, kit)
    const { updatedAt } = (await call('a', 'GET', `/brands/${brand.id}/kit`)).json as { updatedAt: string }
    const first = await call('a', 'PUT', `/brands/${brand.id}/kit`, { ...kit, voice: 'First.', basedOn: updatedAt })
    expect(first.status).toBe(200)
    const second = await call('a', 'PUT', `/brands/${brand.id}/kit`, { ...kit, voice: 'Second.', basedOn: updatedAt })
    expect(second).toEqual({ status: 409, json: { error: 'This kit changed since you opened it' } })
    expect((await call('a', 'GET', `/brands/${brand.id}/kit`)).json).toMatchObject({ voice: 'First.' })
    const next = await call('a', 'PUT', `/brands/${brand.id}/kit`, {
      ...kit,
      voice: 'Third.',
      basedOn: (first.json as { updatedAt: string }).updatedAt,
    })
    expect(next.json).toMatchObject({ voice: 'Third.' })
  })

  it('refuses a save made from no kit once the brand has one', async () => {
    await call('a', 'PUT', `/brands/${brand.id}/kit`, kit)
    const refused = await call('a', 'PUT', `/brands/${brand.id}/kit`, { ...kit, voice: 'Empty tab.', basedOn: null })
    expect(refused.status).toBe(409)
    expect((await call('a', 'GET', `/brands/${brand.id}/kit`)).json).toMatchObject({ voice: kit.voice })
  })

  it('takes a save that names no kit it was made from, as a tab built before does', async () => {
    await call('a', 'PUT', `/brands/${brand.id}/kit`, { ...kit, voice: 'Newer.' })
    const saved = await call('a', 'PUT', `/brands/${brand.id}/kit`, { ...kit, voice: 'Older tab.' })
    expect(saved).toMatchObject({ status: 200, json: { voice: 'Older tab.' } })
  })

  it('gives each save of a kit a later time than the one before', async () => {
    let last = (await call('a', 'PUT', `/brands/${brand.id}/kit`, kit)).json as { updatedAt: string }
    for (let round = 0; round < 5; round++) {
      const saved = (await call('a', 'PUT', `/brands/${brand.id}/kit`, { ...kit, basedOn: last.updatedAt })).json as {
        updatedAt: string
      }
      expect(Date.parse(saved.updatedAt)).toBeGreaterThan(Date.parse(last.updatedAt))
      last = saved
    }
  })

  it("takes a logo only from the brand's own assets", async () => {
    const { asset: logo } = await uploadImage('a', brand.id, png(12, 12, `${run}-logo`))
    expect((await call('a', 'PUT', `/brands/${brand.id}/kit`, { ...kit, logoAssetId: logo.id })).json).toMatchObject({
      logoAssetId: logo.id,
    })
    expect((await call('a', 'PUT', `/brands/${sibling.id}/kit`, { ...kit, logoAssetId: logo.id })).json).toEqual({
      error: 'The logo is not an asset of this brand',
    })
  })

  it('refuses a token used twice or badly named, and keeps kits to their workspace', async () => {
    expect(
      (
        await call('a', 'PUT', `/brands/${brand.id}/kit`, {
          ...kit,
          fonts: [{ token: 'primary', name: 'Body', family: 'Inter' }],
        })
      ).status,
    ).toBe(400)
    expect(
      (
        await call('a', 'PUT', `/brands/${brand.id}/kit`, {
          ...kit,
          colors: [{ token: 'Primary', name: 'P', value: '#000000FF' }],
        })
      ).status,
    ).toBe(400)
    expect(
      (await call('a', 'PUT', `/brands/${brand.id}/kit`, { ...kit, colors: [{ token: 'p', name: 'P', value: 'red' }] }))
        .status,
    ).toBe(400)
    expect(
      (await call('a', 'PUT', `/brands/${brand.id}/kit`, { ...kit, textStyles: [{ ...textStyles[0], token: 'body' }] }))
        .status,
    ).toBe(400)
    expect((await call('b', 'GET', `/brands/${brand.id}/kit`)).status).toBe(404)
    expect((await call('b', 'PUT', `/brands/${brand.id}/kit`, kit)).status).toBe(404)
  })
})
