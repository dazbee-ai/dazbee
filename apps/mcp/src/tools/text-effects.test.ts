// Text effects set by an agent through run_command, as a person's edits set them: each in one step
// with what it changes, the text's box fitted in the same step, and undo taking it back.
import { afterEach, describe, expect, it } from 'vitest'

import { FALLBACK_FAMILIES } from '@dazbee/fonts'
import { loadFontFiles } from '@dazbee/fonts/node'
import { resourceCache, textMeasure } from '@dazbee/renderer'
import { loadCanvasKit } from '@dazbee/renderer/node'
import type { TextProps } from '@dazbee/schema'

import { type TestServer, testServer, textOf } from '../test-client.ts'

let server: TestServer

afterEach(async () => {
  await server.endpoint.close()
})

/** A text on the square frame, as node.create adds it. */
const BADGE = {
  id: 'badge-text',
  parentId: 'sq',
  layer: {
    type: 'text',
    name: 'Badge',
    props: {
      x: 120,
      y: 220,
      width: 360,
      height: 60,
      text: 'Fresh every day',
      style: { fontFamily: 'Noto Sans', fontSize: 40, color: '#111111FF' },
    },
  },
}

/** What `textMeasure` gives `props` with the shipped fonts, measured with no width or `width` wide. */
async function measured(props: TextProps, width: number | null = null) {
  const ck = await loadCanvasKit()
  const cache = resourceCache(ck)
  const resources = cache.resources({ fonts: loadFontFiles(), fallbackFamilies: [...FALLBACK_FAMILIES], images: {} })
  const size = textMeasure(ck, resources)(props, width)
  cache.delete()
  return size
}

describe('a curve', () => {
  it('is set with node.update, the text’s box fitted to the curve in the same step, which undo takes back', async () => {
    server = testServer()
    const agent = await server.connect(server.api.addAccess().token())
    await agent.json('open_design', { brand: 'brand-summer', design: 'design-launch' })
    await agent.json('run_command', { command: 'node.create', input: BADGE })
    const sync = server.sync('design-launch')
    /** The text's props as the server stores them. */
    const stored = () => (sync.state().nodes['badge-text'] as { props?: TextProps } | undefined)?.props
    const straight = stored() as TextProps
    const curve = { shape: 'circle', amount: 80 } as const
    const answer = await agent.call('run_command', {
      command: 'node.update',
      input: { ids: ['badge-text'], patch: { curve } },
    })
    expect(answer.isError).toBeFalsy()
    const size = await measured({ ...straight, curve })
    expect(size.width).toBeGreaterThan(100)
    expect(stored()).toMatchObject({ x: 120, y: 220, ...size, curve })
    expect(textOf(await agent.call('undo'))).toBe('Undid “edit”')
    expect(stored()).toEqual(straight)
  })

  it('is taken off with node.update and curve: null, the box as high as the straight text in the same step', async () => {
    server = testServer()
    const agent = await server.connect(server.api.addAccess().token())
    await agent.json('open_design', { brand: 'brand-summer', design: 'design-launch' })
    await agent.json('run_command', { command: 'node.create', input: BADGE })
    const sync = server.sync('design-launch')
    const stored = () => (sync.state().nodes['badge-text'] as { props?: TextProps } | undefined)?.props
    const update = (patch: Record<string, unknown>) =>
      agent.call('run_command', { command: 'node.update', input: { ids: ['badge-text'], patch } })
    await update({ curve: { shape: 'arcUp', amount: 70 } })
    const curved = stored() as TextProps
    const answer = await update({ curve: null })
    expect(answer.isError).toBeFalsy()
    const straight = stored() as TextProps
    expect(straight).not.toHaveProperty('curve')
    expect(straight).toMatchObject({ x: 120, y: 220, height: (await measured(straight)).height })
    expect(straight.height).toBeLessThan(curved.height)
    expect(textOf(await agent.call('undo'))).toBe('Undid “edit”')
    expect(stored()).toEqual(curved)
  })
})

describe('a bounce', () => {
  it('is set with node.update and a letter turn with text.edit, the box growing in the same step, taken off with null', async () => {
    server = testServer()
    const agent = await server.connect(server.api.addAccess().token())
    await agent.json('open_design', { brand: 'brand-summer', design: 'design-launch' })
    await agent.json('run_command', { command: 'node.create', input: BADGE })
    const sync = server.sync('design-launch')
    const stored = () => (sync.state().nodes['badge-text'] as { props?: TextProps } | undefined)?.props
    const straight = stored() as TextProps
    const bounce = { style: 'random', amount: 60, seed: 4 } as const
    const set = await agent.call('run_command', {
      command: 'node.update',
      input: { ids: ['badge-text'], patch: { bounce } },
    })
    expect(set.isError).toBeFalsy()
    const { height } = await measured({ ...straight, bounce }, straight.width)
    expect(height).toBeGreaterThan(straight.height)
    expect(stored()).toMatchObject({ x: 120, y: 220, width: straight.width, bounce })
    expect(stored()?.height).toBeCloseTo(height, 2)
    const turned = await agent.call('run_command', {
      command: 'text.edit',
      input: { id: 'badge-text', op: { kind: 'style', at: 0, length: 1, style: { turn: -20 } } },
    })
    expect(turned.isError).toBeFalsy()
    expect(stored()?.runs).toEqual([{ start: 0, end: 1, style: { turn: -20 } }])
    const off = await agent.call('run_command', {
      command: 'node.update',
      input: { ids: ['badge-text'], patch: { bounce: null } },
    })
    expect(off.isError).toBeFalsy()
    expect(stored()).not.toHaveProperty('bounce')
    expect(textOf(await agent.call('undo'))).toBe('Undid “edit”')
    expect(stored()?.bounce).toEqual(bounce)
  })
})

describe('a raise', () => {
  it('is set on a run with text.edit, and text typed after it takes the raise of the character before it', async () => {
    server = testServer()
    const agent = await server.connect(server.api.addAccess().token())
    await agent.json('open_design', { brand: 'brand-summer', design: 'design-launch' })
    await agent.json('run_command', {
      command: 'node.create',
      input: { ...BADGE, layer: { ...BADGE.layer, props: { ...BADGE.layer.props, text: '$99' } } },
    })
    const sync = server.sync('design-launch')
    const stored = () => (sync.state().nodes['badge-text'] as { props?: TextProps } | undefined)?.props
    const raised = await agent.call('run_command', {
      command: 'text.edit',
      input: { id: 'badge-text', op: { kind: 'style', at: 0, length: 1, style: { raise: 30 } } },
    })
    expect(raised.isError).toBeFalsy()
    expect(stored()?.runs).toEqual([{ start: 0, end: 1, style: { raise: 30 } }])
    const typed = await agent.call('run_command', {
      command: 'text.edit',
      input: { id: 'badge-text', op: { kind: 'insert', at: 1, text: '€' } },
    })
    expect(typed.isError).toBeFalsy()
    expect(stored()).toMatchObject({ text: '$€99', runs: [{ start: 0, end: 2, style: { raise: 30 } }] })
    const tooFar = await agent.call('run_command', {
      command: 'text.edit',
      input: { id: 'badge-text', op: { kind: 'style', at: 2, length: 2, style: { raise: 120 } } },
    })
    expect(tooFar.isError).toBe(true)
  })
})

describe('an image fill', () => {
  it('is set on a text with node.update and on a run with text.edit, in place of its colour and gradient', async () => {
    server = testServer()
    const agent = await server.connect(server.api.addAccess().token())
    await agent.json('open_design', { brand: 'brand-summer', design: 'design-launch' })
    await agent.json('run_command', { command: 'node.create', input: BADGE })
    const sync = server.sync('design-launch')
    const stored = () => (sync.state().nodes['badge-text'] as { props?: TextProps } | undefined)?.props
    const style = BADGE.layer.props.style
    const image = { type: 'image', assetId: 'asset-bottle', fit: 'tile', tileScale: 0.5, opacity: 1 }
    const filled = await agent.call('run_command', {
      command: 'node.update',
      input: { ids: ['badge-text'], patch: { style: { ...style, image } } },
    })
    expect(filled.isError).toBeFalsy()
    expect(stored()?.style).toEqual({ ...style, image })
    const gradient = {
      type: 'linear',
      from: { x: 0, y: 0 },
      to: { x: 1, y: 0 },
      stops: [
        { offset: 0, color: '#FF0000FF' },
        { offset: 1, color: '#0000FFFF' },
      ],
    }
    const run = await agent.call('run_command', {
      command: 'text.edit',
      input: { id: 'badge-text', op: { kind: 'style', at: 0, length: 5, style: { gradient } } },
    })
    expect(run.isError).toBeFalsy()
    const photo = { type: 'image', assetId: 'asset-bottle', fit: 'fill', opacity: 1 }
    const runImage = await agent.call('run_command', {
      command: 'text.edit',
      input: { id: 'badge-text', op: { kind: 'style', at: 0, length: 2, style: { image: photo } } },
    })
    expect(runImage.isError).toBeFalsy()
    expect(stored()?.runs).toEqual([
      { start: 0, end: 2, style: { image: photo } },
      { start: 2, end: 5, style: { gradient } },
    ])
  })

  it('refuses a crop fit, and a style with both a gradient and an image', async () => {
    server = testServer()
    const agent = await server.connect(server.api.addAccess().token())
    await agent.json('open_design', { brand: 'brand-summer', design: 'design-launch' })
    await agent.json('run_command', { command: 'node.create', input: BADGE })
    const style = BADGE.layer.props.style
    const image = { type: 'image', assetId: 'asset-bottle', fit: 'crop', opacity: 1 }
    const cropped = await agent.call('run_command', {
      command: 'node.update',
      input: { ids: ['badge-text'], patch: { style: { ...style, image } } },
    })
    expect(cropped.isError).toBe(true)
    const runCropped = await agent.call('run_command', {
      command: 'text.edit',
      input: { id: 'badge-text', op: { kind: 'style', at: 0, length: 2, style: { image } } },
    })
    expect(runCropped.isError).toBe(true)
    const gradient = {
      type: 'radial',
      center: { x: 0.5, y: 0.5 },
      radius: 0.5,
      stops: [
        { offset: 0, color: '#FF0000FF' },
        { offset: 1, color: '#0000FFFF' },
      ],
    }
    const both = await agent.call('run_command', {
      command: 'node.update',
      input: { ids: ['badge-text'], patch: { style: { ...style, gradient, image: { ...image, fit: 'fill' } } } },
    })
    expect(both.isError).toBe(true)
  })
})

describe('an extrusion', () => {
  it('is set with node.update, the box growing in height to hold the sides in the same step, taken off with null', async () => {
    server = testServer()
    const agent = await server.connect(server.api.addAccess().token())
    await agent.json('open_design', { brand: 'brand-summer', design: 'design-launch' })
    await agent.json('run_command', { command: 'node.create', input: BADGE })
    const sync = server.sync('design-launch')
    const stored = () => (sync.state().nodes['badge-text'] as { props?: TextProps } | undefined)?.props
    const update = (patch: Record<string, unknown>) =>
      agent.call('run_command', { command: 'node.update', input: { ids: ['badge-text'], patch } })
    const straight = stored() as TextProps
    const extrusion = { depth: 20, angle: 45 }
    expect((await update({ extrusion })).isError).toBeFalsy()
    const { height } = await measured({ ...straight, extrusion }, straight.width)
    // The sides reach 20 % of 40 px along 45°, 5.66 px down, which the auto height box grows by, to whole pixels.
    expect(height).toBe(Math.ceil(straight.height + 8 * Math.SQRT1_2))
    expect(stored()).toMatchObject({ x: 120, y: 220, width: straight.width, height, extrusion })
    const coloured = { depth: 30, angle: 200, color: '#5D4037FF' }
    expect((await update({ extrusion: coloured })).isError).toBeFalsy()
    expect(stored()?.extrusion).toEqual(coloured)
    expect((await update({ extrusion: { depth: 120, angle: 45 } })).isError).toBe(true)
    expect((await update({ extrusion: null })).isError).toBeFalsy()
    expect(stored()).not.toHaveProperty('extrusion')
    expect(stored()?.height).toBe(straight.height)
    expect(textOf(await agent.call('undo'))).toBe('Undid “edit”')
    expect(stored()?.extrusion).toEqual(coloured)
  })
})
