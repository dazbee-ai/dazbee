// What `confirmed` tells of an import from Figma placed on the open core: saved once the sync server
// stores the step, rejected with nothing of it left, too big to send, or ended with the editor.
import { afterEach, describe, expect, it } from 'vitest'

import { openLocalServer, openSession, plainStore } from '@dazbee/doc'
import { type DesignInput, FigmaImport, parseDesign } from '@dazbee/schema'

import { type TestEditor, testEditor, type TestEditorOptions } from './test-editor.ts'
import { frame, LINK, PAGES, placedOf, rect, settled } from './test-place-figma.ts'

let opened: TestEditor[] = []
afterEach(() => {
  for (const t of opened) t.end()
  opened = []
})

/** Opens `design` (the two pages unless given) in the test editor, ended after the test. */
async function open(options: TestEditorOptions = {}, design: DesignInput = PAGES) {
  const t = await testEditor(design, options)
  opened.push(t)
  return t
}

/** A held tab of a local server on the two pages, another tab on it, and the test editor on the held one. */
async function heldEditor() {
  const parsed = parseDesign(PAGES)
  if (!parsed.success) throw new Error(parsed.errors.join('\n'))
  const server = openLocalServer(parsed.design)
  const store = server.join({ held: true })
  const other = openSession(server.join())
  const t = await open({ store })
  return { t, store, other }
}

describe('placeFigma', () => {
  it('resolves confirmed saved only once the sync server has stored the step', async () => {
    const { t, store } = await heldEditor()
    const { confirmed } = placedOf(await t.core.placeFigma(LINK))
    expect(await settled(confirmed)).toBe('waiting')
    store.deliver()
    expect(await settled(confirmed)).toBe('saved')
  })

  it('fails confirmed as rejected when the server refuses the step: nothing of it stays, on neither stack', async () => {
    const { t, store, other } = await heldEditor()
    const { ids, confirmed } = placedOf(await t.core.placeFigma(LINK))
    // Another tab deletes the shown page, and the server takes that first.
    other.run('page.delete', { id: 'p1' })
    store.deliver()
    expect(await settled(confirmed)).toBe('rejected')
    expect([t.core.design().frames[ids.get('3:1') ?? ''], t.core.canUndo(), t.core.canRedo()]).toEqual([
      undefined,
      false,
      false,
    ])
  })

  it('fails confirmed as too big for an import past what one step may send, writing nothing', async () => {
    const parsed = parseDesign(PAGES)
    if (!parsed.success) throw new Error(parsed.errors.join('\n'))
    const t = await open({ store: plainStore(parsed.design, { client: { limits: { messageBytes: 20_000 } } }) })
    const before = t.core.design()
    const many = Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`k${i}`, rect('root', 'a0')]))
    const figma = FigmaImport.parse({
      ...LINK,
      pages: [{ ...LINK.pages[0], frames: [frame('3:1', 0, 0, many, Object.keys(many))] }],
    })
    const { confirmed } = placedOf(await t.core.placeFigma(figma))
    expect(await settled(confirmed)).toBe('tooBig')
    expect([t.core.design(), t.core.canUndo()]).toEqual([before, false])
  })

  it('fails confirmed as ended when the editor ends before the server answers', async () => {
    const { t } = await heldEditor()
    const { confirmed } = placedOf(await t.core.placeFigma(LINK))
    t.end()
    opened = opened.filter((e) => e !== t)
    expect(await settled(confirmed)).toBe('ended')
  })
})
