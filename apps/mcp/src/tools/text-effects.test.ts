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
