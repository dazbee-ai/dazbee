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

/** What `textMeasure` gives `props` with the shipped fonts. */
async function measured(props: TextProps) {
  const ck = await loadCanvasKit()
  const cache = resourceCache(ck)
  const resources = cache.resources({ fonts: loadFontFiles(), fallbackFamilies: [...FALLBACK_FAMILIES], images: {} })
  const size = textMeasure(ck, resources)(props, null)
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
})
