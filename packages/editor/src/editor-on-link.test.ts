// Two editors on one sync server in memory, each on the tab `openTab` opens (D4, D10, D12, K17):
// a step reaches the other tab once it ends, a change from another tab moves a waiting caret along,
// a Reviewer's editor sends nothing, and a tab whose member is moved down to Reviewer says what it didn't keep,
// but says nothing of it once its link has ended.
import { afterEach, describe, expect, it } from 'vitest'

import type { Client } from '@dazbee/doc'
import { loadFontFiles } from '@dazbee/fonts/node'
import type { Member } from '@dazbee/schema'

import type { CatalogFont, FontSources } from './font-loads.ts'
import { openTab } from './open-tab.ts'
import type { ResourceSources } from './resources.ts'
import { WORDS } from './test-actions.ts'
import { type TestEditor, testEditor } from './test-editor.ts'
import { type MemorySync, memorySync } from './test-link.ts'
import { TokenRefused } from './token-source.ts'

const ANN: Member = { userId: 'ann', workspaceId: 'w1' }
const VIC: Member = { userId: 'vic', workspaceId: 'w1' }

let mem: MemorySync
const editors: TestEditor[] = []
const closing: (() => Promise<void>)[] = []

afterEach(async () => {
  for (const e of editors.splice(0)) e.end()
  for (const close of closing.splice(0)) await close()
})

/** A font the tests make wait: each load waits for `bring`, which gives it a wide face. */
function slowFonts() {
  const wide = loadFontFiles().find((f) => f.file === 'NotoSans-ExtraBold.ttf')?.bytes ?? new Uint8Array()
  const loads: { families: string[]; resolve: (faces: CatalogFont[]) => void }[] = []
  return {
    sources: {
      fontFaces: (families: string[]) => new Promise<CatalogFont[]>((resolve) => loads.push({ families, resolve })),
      fontFile: () => Promise.resolve(wide),
    } satisfies FontSources,
    /** Settles every load asked for so far. */
    bring() {
      for (const load of loads.splice(0))
        load.resolve(load.families.map((family) => ({ id: family, family, weight: 400, style: 'normal' })))
    },
  }
}

/**
 * An editor on a tab of the server in memory, as `token`'s member, or as the member the token it gives
 * names; a dropped connection comes back at once.
 */
async function editorOn(
  token: string | (() => string | Promise<string>) = 'ann',
  member = ANN,
  sources: ResourceSources = {},
) {
  const tab = await openTab({
    designId: 'd',
    member,
    url: 'ws://s',
    token: () => Promise.resolve(typeof token === 'string' ? token : token()),
    socket: mem.socket,
    random: () => 0,
  })
  closing.push(() => tab.close())
  const editor = await testEditor(WORDS, { tab, sources })
  editors.push(editor)
  return Object.assign(editor, { tab })
}

/** Lets every message on its way land, and what it set going run. */
async function settle() {
  for (let n = 0; n < 5; n++) {
    await mem.settle()
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

/** Waits for the open steps' previews, which a tab sends at most every 33 ms, to reach the other tabs. */
async function previewsLand() {
  await new Promise((resolve) => setTimeout(resolve, 80))
  await settle()
}

/** The middle of layer `id` of the square frame, as a stage point. */
function middleOf(e: TestEditor, id: string) {
  const box = e.core.design().nodes[id]?.props as { x: number; y: number; width: number; height: number }
  return e.core.stagePoint(box.x + box.width / 2, box.y + box.height / 2, 'sq')
}

const textOf = (e: TestEditor, id: string) => (e.core.design().nodes[id]?.props as { text: string }).text
const xOf = (e: TestEditor, id: string) => (e.core.design().nodes[id]?.props as { x: number }).x

/**
 * Ann's editor, whose token from `demote` on gives the Reviewer's role, as the API signs it once she is
 * moved down; `demote` then has the server ask for a fresh one, as it does before her token expires.
 */
async function demotable() {
  let token = 'ann'
  const e = await editorOn(() => token)
  const demote = () => {
    token = 'viewer'
    mem.sockets.at(-1)?.deliver({ type: 'token' })
  }
  return Object.assign(e, { demote })
}

/** What the editor told the page that says the tab now only views and its unsaved changes weren't kept. */
const notKept = (e: TestEditor) =>
  e.told.filter(
    ([notice, detail]) => notice === 'nowViewOnly' || (notice === 'rejected' && detail.reason === 'viewOnly'),
  )

/** Goes into text `id` with the caret at its end, typing nothing yet. */
function caretAtEnd(e: TestEditor, id: string) {
  e.core.select([id])
  e.press('goIn')
  e.keys.press('End')
}

describe('two editors on one design', () => {
  it("shows a drag in the other tab's design only once it ends (K17), and drawn as a preview while it is open (D7)", async () => {
    mem = memorySync(WORDS)
    const a = await editorOn()
    const b = await editorOn('bob', { userId: 'bob', workspaceId: 'w1' })
    const from = middleOf(a, 'a')
    const before = xOf(b, 'a')
    a.mouse.move(from.x, from.y)
    a.mouse.down()
    a.mouse.move(from.x + 60, from.y, { steps: 6 })
    await previewsLand()
    expect(xOf(a, 'a')).not.toBe(xOf(b, 'a'))
    expect(xOf(b, 'a')).toBe(before)
    // B draws A's open drag: the layer where A has it, in the design B's canvas draws.
    b.core.redraw()
    expect(b.modules.view.previewed().nodes.a?.props.x).toBe(xOf(a, 'a'))
    a.mouse.up()
    await settle()
    expect(xOf(b, 'a')).toBe(xOf(a, 'a'))
    b.core.redraw()
    expect(b.modules.view.previewed()).toBe(b.modules.view.design())
  })

  it('tells the page another tab is typing in the text it starts editing (C47), once a start', async () => {
    mem = memorySync(WORDS)
    const a = await editorOn()
    const b = await editorOn('bob', { userId: 'bob', workspaceId: 'w1' })
    caretAtEnd(a, 'words')
    a.keys.press('!')
    await previewsLand()
    caretAtEnd(b, 'words')
    b.keys.press('?')
    b.keys.press('?')
    const told = () => b.told.filter(([notice]) => notice === 'editingElsewhere')
    expect(told()).toEqual([['editingElsewhere', { name: expect.any(String) }]])
    // Each start tells once, not each key; with A's step landed, a start tells nothing.
    b.keys.press('Escape')
    caretAtEnd(b, 'words')
    expect(told()).toHaveLength(2)
    b.keys.press('Escape')
    a.keys.press('Escape')
    await settle()
    caretAtEnd(b, 'words')
    expect(told()).toHaveLength(2)
  })

  it('shows typing in the other tab once the typist leaves the text', async () => {
    mem = memorySync(WORDS)
    const a = await editorOn()
    const b = await editorOn('bob', { userId: 'bob', workspaceId: 'w1' })
    caretAtEnd(a, 'words')
    a.keys.press('!')
    await settle()
    expect(textOf(a, 'words')).toBe('Hello there!')
    expect(textOf(b, 'words')).toBe('Hello there')
    a.keys.press('Escape')
    await settle()
    expect(textOf(b, 'words')).toBe('Hello there!')
  })

  it('moves a waiting caret along with a change from the other tab, and the next key keeps that change (D4)', async () => {
    mem = memorySync(WORDS)
    const a = await editorOn()
    const b = await editorOn('bob', { userId: 'bob', workspaceId: 'w1' })
    caretAtEnd(a, 'words')
    b.core.select(['words'])
    b.press('goIn')
    b.keys.press('Home')
    for (const key of ['H', 'o', 't', ' ']) b.keys.press(key)
    b.keys.press('Escape')
    await settle()
    expect(textOf(a, 'words')).toBe('Hot Hello there')
    a.keys.press('!')
    a.keys.press('Escape')
    await settle()
    expect(textOf(a, 'words')).toBe('Hot Hello there!')
    expect(textOf(b, 'words')).toBe('Hot Hello there!')
  })

  it('keeps the text of the step that ends later when both type in one text (D12, the loss it accepts)', async () => {
    mem = memorySync(WORDS)
    const a = await editorOn()
    const b = await editorOn('bob', { userId: 'bob', workspaceId: 'w1' })
    caretAtEnd(a, 'words')
    caretAtEnd(b, 'words')
    a.keys.press('A')
    b.keys.press('B')
    a.keys.press('Escape')
    await settle()
    b.keys.press('Escape')
    await settle()
    expect(textOf(a, 'words')).toBe(textOf(b, 'words'))
    expect(textOf(b, 'words')).toBe((mem.state().nodes.words as { props: { text: string } }).props.text)
    expect(textOf(b, 'words')).toMatch(/B$/)
  })

  it('changes nothing from a Reviewer’s editor, says View only once, and sends the server nothing', async () => {
    mem = memorySync(WORDS)
    const viewer = await editorOn('viewer', VIC)
    const before = JSON.stringify(viewer.core.design())
    const from = middleOf(viewer, 'a')
    viewer.mouse.drag(from, { x: from.x + 80, y: from.y })
    await settle()
    viewer.core.select(['a'])
    viewer.press('nudgeRight')
    await settle()
    expect(JSON.stringify(viewer.core.design())).toBe(before)
    expect(viewer.told.filter(([kind]) => kind === 'viewOnly')).toEqual([['viewOnly']])
    expect(mem.sockets.flatMap((s) => s.sent).filter((m) => m.type === 'changes')).toEqual([])
  })

  it('says the tab now only views and the typing not yet saved wasn’t kept, when a renewal moves its member down to Reviewer', async () => {
    mem = memorySync(WORDS)
    const a = await demotable()
    caretAtEnd(a, 'words')
    a.keys.press('!')
    a.demote()
    await settle()
    expect(a.core.readOnly()).toBe(true)
    expect(notKept(a)).toHaveLength(1)
    expect(textOf(a, 'words')).toBe('Hello there')
    expect((mem.state().nodes.words as { props: { text: string } }).props.text).toBe('Hello there')
  })

  it('says the tab now only views and the drag not yet saved wasn’t kept, when a renewal moves its member down to Reviewer', async () => {
    mem = memorySync(WORDS)
    const a = await demotable()
    const from = middleOf(a, 'a')
    const before = xOf(a, 'a')
    a.mouse.move(from.x, from.y)
    a.mouse.down()
    a.mouse.move(from.x + 60, from.y, { steps: 6 })
    expect(xOf(a, 'a')).not.toBe(before)
    a.demote()
    await settle()
    a.mouse.up()
    await settle()
    expect(a.core.readOnly()).toBe(true)
    expect(notKept(a)).toHaveLength(1)
    expect(xOf(a, 'a')).toBe(before)
  })

  it('says nothing of changes not kept when the API refuses the token while a drag that wrote is held, which ends the link', async () => {
    mem = memorySync(WORDS)
    let refused = false
    const a = await editorOn(() => (refused ? Promise.reject(new TokenRefused()) : 'ann'))
    const from = middleOf(a, 'a')
    const before = xOf(a, 'a')
    a.mouse.move(from.x, from.y)
    a.mouse.down()
    a.mouse.move(from.x + 60, from.y, { steps: 6 })
    expect(xOf(a, 'a')).not.toBe(before)
    refused = true
    mem.sockets.at(-1)?.cut()
    await new Promise((resolve) => setTimeout(resolve, 10))
    await settle()
    a.mouse.up()
    await settle()
    expect(a.tab.link.ended()).toBe('refused')
    expect(a.core.readOnly()).toBe(true)
    expect(xOf(a, 'a')).toBe(before)
    expect(notKept(a)).toEqual([])
  })

  it('says nothing of changes not kept when a renewal moves its member down with nothing unsaved', async () => {
    mem = memorySync(WORDS)
    const a = await demotable()
    a.core.select(['a'])
    a.press('nudgeRight')
    await settle()
    // A marquee held writes nothing.
    a.mouse.move(4, 4)
    a.mouse.down()
    a.mouse.move(40, 40, { steps: 4 })
    a.demote()
    await settle()
    a.mouse.up()
    expect(a.core.readOnly()).toBe(true)
    expect(notKept(a)).toEqual([])
  })

  it('says nothing of changes not kept when a renewal moves its member down while a press on a layer is held still', async () => {
    mem = memorySync(WORDS)
    const a = await demotable()
    const at = middleOf(a, 'a')
    a.mouse.move(at.x, at.y)
    a.mouse.down()
    a.demote()
    await settle()
    a.mouse.up()
    expect(a.core.readOnly()).toBe(true)
    expect(notKept(a)).toEqual([])
  })

  it('sends the follow-up a crossing edit owes once the font its text waits for loads (D6)', async () => {
    mem = memorySync(WORDS)
    const fonts = slowFonts()
    const a = await editorOn('ann', ANN, fonts.sources)
    const b = await editorOn('bob', { userId: 'bob', workspaceId: 'w1' }, fonts.sources)
    const style = (a.core.design().nodes.words?.props as { style: Record<string, unknown> }).style
    /** One step on the tab's client that sets a prop of the words, sent at once. */
    const step = (e: typeof a, prop: string, to: unknown) => {
      const client = e.tab.link.client() as Client
      client.open()
      client.write({ op: 'set', value: { part: 'layer', id: 'words', key: 'props', prop }, to } as never)
      e.tab.link.send(client.end(null))
    }
    // The words take a font that is still to load, in both tabs.
    const late = { ...style, fontFamily: 'Late' }
    step(a, 'style', late)
    await settle()
    // From the same design, A makes the text wrap and B makes it bigger: both reach the server
    // before either tab hears of the other's, and the box fits neither change alone.
    step(a, 'boxMode', 'autoHeight')
    step(b, 'style', { ...late, fontSize: 140 })
    await settle()
    const owes = () => [a, b].some((e) => (e.tab.link.client() as Client).owes())
    expect(owes()).toBe(true)
    fonts.bring()
    await settle()
    expect(owes()).toBe(false)
    const box = (e: typeof a) => {
      const { width, height } = e.core.design().nodes.words?.props as { width: number; height: number }
      return { width, height }
    }
    expect(box(a)).toEqual(box(b))
    expect(box(a)).not.toEqual({ width: 600, height: 120 })
  })
})
