// A composition in the text being edited, driven through the editor's input as the stage field
// drives it: drawn in the frame's picture but never written, sent or undone, and its commit typed
// in as one edit in the typing step.
import { afterEach, describe, expect, it } from 'vitest'

import type { Member } from '@dazbee/schema'

import { openTab } from '../open-tab.ts'
import { WORDS } from '../test-actions.ts'
import { type TestEditor, testEditor } from '../test-editor.ts'
import { type MemorySync, memorySync } from '../test-link.ts'
import type { FieldState } from './field-change.ts'

const ANN: Member = { userId: 'ann', workspaceId: 'w1' }
const BOB: Member = { userId: 'bob', workspaceId: 'w1' }

let mem: MemorySync
const editors: TestEditor[] = []
const closing: (() => Promise<void>)[] = []

afterEach(async () => {
  for (const e of editors.splice(0)) e.end()
  for (const close of closing.splice(0)) await close()
})

/** An editor on a tab of the server in memory, as Ann or Bob. */
async function editorOn(token: 'ann' | 'bob' = 'ann') {
  const tab = await openTab({
    designId: 'd',
    member: token === 'ann' ? ANN : BOB,
    url: 'ws://s',
    token: () => Promise.resolve(token),
    socket: mem.socket,
    random: () => 0,
  })
  closing.push(() => tab.close())
  const editor = await testEditor(WORDS, { tab })
  editors.push(editor)
  return editor
}

/** Lets every message on its way land, and what it set going run. */
async function settle() {
  for (let n = 0; n < 5; n++) {
    await mem.settle()
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

/** Waits past the time a tab sends its open step's preview in. */
async function previewsLand() {
  await new Promise((resolve) => setTimeout(resolve, 80))
  await settle()
}

const textOf = (e: TestEditor, id = 'words') => (e.core.design().nodes[id]?.props as { text: string }).text

/** Goes into the words with the caret at their end, and gives the field its text. */
function typingAtEnd(e: TestEditor) {
  e.core.select(['words'])
  e.press('goIn')
  e.keys.press('End')
  return e.core.input.fieldText()
}

/**
 * The field as an input method leaves it, from what it was given: `composed` in place of its
 * selection, the field's caret after it.
 */
function composedIn(given: FieldState, composed: string): FieldState {
  const value = given.value.slice(0, given.start) + composed + given.value.slice(given.end)
  const caret = given.start + composed.length
  return { value, start: caret, end: caret }
}

/** What a tab sent its server of the kinds given. */
const sentOf = (kinds: string[]) =>
  mem.sockets.flatMap((s) => s.sent).filter((message) => kinds.includes(message.type))

describe('a composition', () => {
  it('writes, sends and undoes nothing while composing, and types its commit once', async () => {
    mem = memorySync(WORDS)
    const a = await editorOn()
    const b = await editorOn('bob')
    const given = typingAtEnd(a)
    if (!given) throw new Error('no field text')
    await settle()
    const sentBefore = sentOf(['changes', 'preview']).length
    const design = a.core.session.design()
    const changes = a.core.session.changes()
    for (const typed of ['n', 'ni', 'nih', 'niha', 'nihao']) {
      expect(a.core.input.fieldChanged(composedIn(given, typed), typed)).toBe(true)
      a.core.redraw()
    }
    expect(a.core.session.design()).toBe(design)
    expect(a.core.session.changes()).toBe(changes)
    expect(a.core.session.canUndo()).toBe(false)
    await previewsLand()
    expect(sentOf(['changes', 'preview'])).toHaveLength(sentBefore)
    expect(textOf(b)).toBe('Hello there')

    a.core.input.fieldChanged(composedIn(given, '你好'), null)
    // A late end of the same composition types nothing more.
    a.core.input.fieldChanged(composedIn(given, '你好'), null)
    expect(textOf(a)).toBe('Hello there你好')
    a.keys.press('Escape')
    await settle()
    expect(textOf(b)).toBe('Hello there你好')
  })
})
