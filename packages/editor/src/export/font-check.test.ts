// The check before export (fonts step 3): the families the texts of the frames to export name that
// the catalog has no file for, and the characters no font draws, with the texts they are in.
import { afterEach, describe, expect, it } from 'vitest'

import { loadFontFiles } from '@dazbee/fonts/node'
import type { DesignInput } from '@dazbee/schema'

import type { FontSources } from '../font-loads.ts'
import { type TestEditor, testEditor } from '../test-editor.ts'

let editor: TestEditor | undefined
afterEach(() => editor?.end())

/** A text named `name` in frame `parentId`, in `family`. */
const text = (parentId: string, index: string, name: string, words: string, family: string, extra = {}) => ({
  type: 'text' as const,
  parentId,
  link: `${parentId}-${index}`,
  index,
  name,
  props: {
    x: 40,
    y: 40 + Number.parseInt(index.slice(1), 36) * 60,
    width: 900,
    height: 50,
    text: words,
    boxMode: 'fixed' as const,
    style: { fontFamily: family, fontSize: 40, color: '#000000FF' },
    ...extra,
  },
})

/** Two pages: the square and an unticked frame on the first, a far frame on the second. */
const DESIGN: DesignInput = {
  meta: { designId: 'd', name: 'D' },
  pages: { p1: { name: 'One', order: 'a0' }, p2: { name: 'Two', order: 'a1' } },
  frames: {
    sq: { pageId: 'p1', name: 'Square', width: 1080, height: 1080, x: 0, y: 0, order: 'a0' },
    off: { pageId: 'p1', name: 'Off', width: 1080, height: 1080, x: 1200, y: 0, order: 'a1' },
    far: { pageId: 'p2', name: 'Far', width: 1080, height: 1080, x: 0, y: 0, order: 'a0' },
  },
  nodes: {
    head: text('sq', 'a1', 'Headline', 'Runes ᚠ', 'Nope Sans'),
    body: text('sq', 'a2', 'Body', 'Fine words', 'Have Sans'),
    shut: text('sq', 'a3', 'Hidden', 'Clef 𝄞', 'Hidden Sans', { visible: false }),
    runs: text('sq', 'a4', 'Runs', 'ab', 'Base Sans', {
      runs: [{ start: 0, end: 2, style: { fontFamily: 'Run Sans' } }],
    }),
    other: text('off', 'a1', 'Other', 'Off ᚱ', 'Off Sans'),
    copy: text('far', 'a1', 'Headline', 'Clef 𝄞 ᚠ', 'Noto Sans'),
  },
}

/** A catalog with one family, Have Sans (Noto Sans's file under another name); with `failing`, every ask after the first (the editor opening) rejects. */
function catalog() {
  const asked: string[][] = []
  const state = { failing: false }
  const noto = loadFontFiles().find((f) => f.family === 'Noto Sans' && f.weight === 400 && f.style === 'normal')
  if (!noto) throw new Error('no Noto Sans')
  return {
    asked,
    state,
    sources: {
      fontFaces: async (families: string[]) => {
        asked.push(families)
        if (state.failing && asked.length > 1) throw new Error('no network')
        return families.includes('Have Sans')
          ? [{ id: 'have', family: 'Have Sans', weight: 400, style: 'normal' as const }]
          : []
      },
      fontFile: () => Promise.resolve(noto.bytes),
    } satisfies FontSources,
  }
}

describe('fontCheck', () => {
  it('lists the families the catalog has no file for and the characters no font has, for the frames asked', async () => {
    editor = await testEditor(DESIGN, { sources: catalog().sources })
    expect(await editor.core.fontCheck(['sq'])).toEqual({
      families: ['Nope Sans', 'Run Sans'],
      characters: [{ text: 'ᚠ', layers: ['Headline'] }],
    })
  })

  it('reads a frame on another page, and gives a name once for texts that share it', async () => {
    editor = await testEditor(DESIGN, { sources: catalog().sources })
    expect(await editor.core.fontCheck(['sq', 'far'])).toEqual({
      families: ['Nope Sans', 'Run Sans'],
      characters: [
        { text: 'ᚠ', layers: ['Headline'] },
        { text: '𝄞', layers: ['Headline'] },
      ],
    })
  })

  it('lists no family whose load failed, which may well exist', async () => {
    const source = catalog()
    source.state.failing = true
    editor = await testEditor(
      { ...DESIGN, nodes: { body: text('sq', 'a2', 'Body', 'Fine words', 'Have Sans') } } as DesignInput,
      { sources: source.sources },
    )
    // A family the text takes after the design opened, whose load fails.
    const style = { fontFamily: 'Later Sans', fontSize: 40, color: '#000000FF' }
    editor.core.session.run('node.update', { ids: ['body'], patch: { style } })
    expect((await editor.core.fontCheck(['sq'])).families).toEqual([])
    expect(source.asked).toEqual([['Have Sans'], ['Later Sans']])
  })

  it('lists a family the catalog had no faces for as the design opened, asking for it once', async () => {
    const source = catalog()
    editor = await testEditor(DESIGN, { sources: source.sources })
    expect((await editor.core.fontCheck(['sq'])).families).toEqual(['Nope Sans', 'Run Sans'])
    expect(source.asked).toHaveLength(1)
  })

  it('names a brand-bound text’s family as the kit gives it', async () => {
    editor = await testEditor(
      {
        ...DESIGN,
        nodes: {
          body: { ...text('sq', 'a2', 'Body', 'Fine', 'Have Sans'), bindings: { fontFamily: 'brand:heading' } },
        },
      } as DesignInput,
      { sources: catalog().sources },
    )
    await editor.core.setVariables({ 'brand:heading': 'Kit Sans' })
    expect((await editor.core.fontCheck(['sq'])).families).toEqual(['Kit Sans'])
  })

  it('checks a text in an auto layout box and one that shrinks to fit as they are drawn, the same in a view-only tab', async () => {
    const drawn: DesignInput = {
      ...DESIGN,
      nodes: {
        row: {
          type: 'box',
          parentId: 'sq',
          link: 'row',
          index: 'a0',
          name: 'Row',
          props: {
            x: 40,
            y: 600,
            width: 400,
            height: 100,
            layout: { direction: 'column', gap: 10, align: 'start' },
            sizing: { width: 'hug', height: 'hug' },
          },
        },
        inRow: { ...text('sq', 'a1', 'In row', 'Laid ᚠ', 'Noto Sans'), parentId: 'row', link: 'inRow' },
        shrunk: text('sq', 'a2', 'Shrunk', 'A long line that shrinks to fit ᚱ', 'Noto Sans', {
          shrinkToFit: { min: 8, max: 120 },
        }),
      },
    }
    const want = {
      families: [],
      characters: [
        { text: 'ᚠ', layers: ['In row'] },
        { text: 'ᚱ', layers: ['Shrunk'] },
      ],
    }
    editor = await testEditor(drawn, { sources: catalog().sources })
    expect(await editor.core.fontCheck(['sq'])).toEqual(want)
    editor.end()
    editor = await testEditor(drawn, {
      sources: catalog().sources,
      access: { readOnly: () => true, onChange: () => () => {} },
    })
    expect(editor.core.readOnly()).toBe(true)
    expect(await editor.core.fontCheck(['sq'])).toEqual(want)
  })

  it('writes nothing to the design', async () => {
    editor = await testEditor(DESIGN, { sources: catalog().sources })
    const before = JSON.stringify(editor.core.design())
    const undo = editor.core.canUndo()
    await editor.core.fontCheck(['sq', 'far'])
    expect([JSON.stringify(editor.core.design()), editor.core.canUndo()]).toEqual([before, undo])
  })
})
