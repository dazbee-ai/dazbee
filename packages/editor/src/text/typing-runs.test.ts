// Text typed or pasted over a range takes the run of the first character it replaces, as a word
// processor types it.
import { describe, expect, it } from 'vitest'

import { WORDS } from '../test-actions.ts'
import { testEditor } from '../test-editor.ts'

describe('typing over a range', () => {
  it('types a key or a paste over a bold word after plain text in the bold of that word', async () => {
    const editor = await testEditor(WORDS)
    const { typing } = editor.modules
    const words = () => editor.core.design().nodes.words?.props as { text: string; runs: unknown[] }
    editor.core.select(['words'])
    editor.press('goIn')
    typing.styleRange({ id: 'words', range: { start: 6, end: 11 } }, { fontWeight: 700 })
    typing.selectText({ start: 6, end: 11 })
    editor.keys.press('w')
    expect(words()).toMatchObject({ text: 'Hello w', runs: [{ start: 6, end: 7, style: { fontWeight: 700 } }] })
    typing.selectText({ start: 6, end: 7 })
    typing.paste({ text: 'world' })
    expect(words()).toMatchObject({ text: 'Hello world', runs: [{ start: 6, end: 11, style: { fontWeight: 700 } }] })
    editor.end()
  })
})
