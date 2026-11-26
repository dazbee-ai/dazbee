// A text that grows with its words, fitted while a font it is drawn in was still coming, is fitted
// again once that load settles: untracked, after an open gesture, and only while it still grows.
import { afterEach, describe, expect, it } from 'vitest'

import { CommandFault, fittedText, type FitText, type KeptPoint } from '@dazbee/doc'
import { EMOJI_FAMILY } from '@dazbee/fonts'
import { emojiTestFont, TEST_EMOJI } from '@dazbee/fonts/test-fonts'
import type { Design, Layer, TextProps } from '@dazbee/schema'

import type { ListedFace } from '../font-loads.ts'
import { openTab } from '../open-tab.ts'
import { WORDS } from '../test-actions.ts'
import { shippedOnly } from '../test-catalog.ts'
import { type TestEditor, testEditor } from '../test-editor.ts'
import { memorySync } from '../test-link.ts'
import { owedFits } from './owed-fits.ts'

let editor: TestEditor | undefined
let closing: (() => Promise<void>) | undefined
afterEach(async () => {
  editor?.end()
  await closing?.()
  closing = undefined
})

const settled = () => new Promise((resolve) => setTimeout(resolve, 0))

/**
 * An editor over the words design, its words growing with them, whose font loads a test lets through, but the
 * shipped fonts'; on a tab of a server in memory, with the core's recompute bound to it, when `onTab`.
 */
async function slowEmoji(onTab = false) {
  const asked: string[][] = []
  const waiting: (() => void)[] = []
  const fontFaces = (families: string[]) => {
    if (shippedOnly(families)) return Promise.resolve([])
    asked.push(families)
    return new Promise<ListedFace[]>((resolve) => {
      waiting.push(() =>
        resolve(families.map((family) => ({ id: family, family, weight: 400, style: 'normal' as const }))),
      )
    })
  }
  const fontFile = () => Promise.resolve(emojiTestFont())
  const tab = onTab
    ? await openTab({
        designId: 'd',
        member: { userId: 'ann', workspaceId: 'w1' },
        url: 'ws://s',
        token: () => Promise.resolve('ann'),
        socket: memorySync(WORDS).socket,
      })
    : undefined
  closing = tab && (() => tab.close())
  editor = await testEditor(WORDS, { sources: { fontFaces, fontFile }, ...(tab ? { tab } : {}) })
  const { core, modules } = editor
  core.session.run('node.update', { ids: ['words'], patch: { boxMode: 'autoWidth' } })
  const words = () => core.design().nodes.words as Layer & { props: TextProps }
  /** What the words would measure in the fonts here now. */
  const fitted = () => fittedText(words(), modules.scenes.measure(), undefined)
  /** Lets the oldest load through, and waits for it to settle. */
  const bring = async () => {
    waiting.shift()?.()
    await settled()
  }
  return { core, modules, words, fitted, bring, asked }
}

describe('owed fits', () => {
  it('fits a text typed with an emoji again, untracked, once the emoji font comes', async () => {
    const { core, modules, words, fitted, bring, asked } = await slowEmoji(true)
    const { typing } = modules
    typing.start('words', 'sq', 11)
    typing.paste({ text: ` ${TEST_EMOJI}` })
    typing.stop()
    expect(asked).toEqual([[EMOJI_FAMILY]])
    const inFallback = words().props.width
    expect(inFallback).toBe(fitted()?.width)
    await bring()
    expect(words().props.width).not.toBe(inFallback)
    expect(words().props.width).toBe(fitted()?.width)
    // Untracked: one undo takes the paste back whole and leaves the refit, as another tab's write, and the tab's
    // follow-up fits the words again; so does redo's.
    core.session.undo()
    expect(words().props).toMatchObject({ text: 'Hello there', width: fitted()?.width })
    core.session.redo()
    expect(words().props).toMatchObject({ text: `Hello there ${TEST_EMOJI}`, width: fitted()?.width })
  })

  it('fits a Chinese text a font was picked for again once the Chinese font comes', async () => {
    const { core, words, fitted, bring, asked } = await slowEmoji()
    core.session.run('text.edit', { id: 'words', op: { kind: 'insert', at: 0, text: '新品 ' } })
    asked.length = 0
    core.select(['words'])
    await core.setFont('Noto Sans', 700)
    expect(asked).toEqual([['Noto Sans SC']])
    // The test's Chinese font has no Han, so it measures as the fallback did: a box made wrong shows the refit.
    core.session.run('node.update', { ids: ['words'], patch: { width: 10 } })
    await bring()
    expect(words().props.width).toBe(fitted()?.width)
    expect(words().props.width).not.toBe(10)
  })

  it('waits for an open gesture to end before it fits', async () => {
    const { core, modules, words, bring } = await slowEmoji()
    const { typing } = modules
    typing.start('words', 'sq', 11)
    typing.paste({ text: TEST_EMOJI })
    const inFallback = words().props.width
    await bring()
    // Typing is open: its step holds the gesture.
    expect(words().props.width).toBe(inFallback)
    typing.stop()
    expect(words().props.width).not.toBe(inFallback)
    expect(core.session.inGesture()).toBe(false)
  })

  it('leaves a text deleted before the font came', async () => {
    const { core, modules, bring } = await slowEmoji()
    modules.typing.start('words', 'sq', 11)
    modules.typing.paste({ text: TEST_EMOJI })
    modules.typing.stop()
    core.session.run('node.delete', { ids: ['words'] })
    await bring()
    expect(core.design().nodes.words).toBeUndefined()
  })

  it('leaves a text made a fixed box before the font came', async () => {
    const { core, modules, words, bring } = await slowEmoji()
    const { typing } = modules
    typing.start('words', 'sq', 11)
    typing.paste({ text: TEST_EMOJI })
    typing.stop()
    core.session.run('node.update', { ids: ['words'], patch: { boxMode: 'fixed' } })
    const before = words().props.width
    await bring()
    expect(words().props.width).toBe(before)
  })

  it('owes nothing for a text whose fonts are here', async () => {
    const { modules, words, bring, asked } = await slowEmoji()
    const { typing } = modules
    typing.start('words', 'sq', 11)
    typing.paste({ text: '!' })
    typing.stop()
    expect(asked).toEqual([])
    const before = words().props.width
    await bring()
    expect(words().props.width).toBe(before)
  })
})

describe('owedFits', () => {
  const layer = { type: 'text' } as Layer
  /** Owed fits over one text, `words`, whose fit answers what `answer` holds when asked. */
  function owing(untracked: <T>(steps: () => T) => T | undefined = (steps) => steps()) {
    let answer: ReturnType<FitText> = 'wait'
    const design = { nodes: { words: layer } } as unknown as Design
    const owed = owedFits({ session: { design: () => design, untracked }, fit: () => answer })
    const fitted: string[] = []
    return {
      owed,
      fitted,
      answer: (to: ReturnType<FitText>) => (answer = to),
      fitText: (id: string, keep?: KeptPoint) => fitted.push(keep ? `${id} ${keep}` : id),
    }
  }

  it('keeps a text owed while its own font is still coming, and fits it once, when it is here', () => {
    const { owed, fitted, answer, fitText } = owing()
    owed.owe('words')
    owed.settle(fitText)
    expect(fitted).toEqual([])
    answer({ width: 10, height: 10 })
    owed.settle(fitText)
    owed.settle(fitText)
    expect(fitted).toEqual(['words'])
  })

  it('fits a text owed a fit that keeps its centre keeping its centre', () => {
    const { owed, fitted, answer, fitText } = owing()
    owed.owe('words', 'center')
    answer({ width: 10, height: 10 })
    owed.settle(fitText)
    expect(fitted).toEqual(['words center'])
  })

  it('owes nothing more for a text that keeps its box', () => {
    const { owed, fitted, answer, fitText } = owing()
    owed.owe('words')
    answer(undefined)
    owed.settle(fitText)
    answer({ width: 10, height: 10 })
    owed.settle(fitText)
    expect(fitted).toEqual([])
  })

  it('throws no fault of the refit on to the loads, whose fault listeners were told', () => {
    const { owed, answer, fitText } = owing(() => {
      throw new CommandFault('text.fit', {}, new Error('boom'))
    })
    owed.owe('words')
    answer({ width: 10, height: 10 })
    expect(() => owed.settle(fitText)).not.toThrow()
  })
})
