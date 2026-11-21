import { describe, expect, it } from 'vitest'

import { loadFontFiles } from '@dazbee/fonts/node'
import type { ResourceBytes } from '@dazbee/renderer'
import type { DesignInput, TextLook, TextProps, Variables } from '@dazbee/schema'

import { type BrandKitDeps, editorBrandKit } from './brand-kit.ts'
import { sessionOf } from './layers/test-boxes.ts'
import { editorSelection } from './selection.ts'
import { testEditor } from './test-editor.ts'
import { copyIn, frameDesign, linkedFrames } from './test-matrix/design-builders.ts'

const STYLE = { fontFamily: 'Noto Sans', fontSize: 20, color: '#000000FF' }
/** One page with one frame: a square, a text, and a text bound to the brand's heading font. */
const DESIGN: DesignInput = {
  meta: { designId: 'd', name: 'D' },
  pages: { p1: { name: 'One', order: 'a0' } },
  frames: { sq: { pageId: 'p1', name: 'Square', width: 1080, height: 1080, x: 0, y: 0, order: 'a0' } },
  nodes: {
    a: {
      type: 'graphic',
      parentId: 'sq',
      link: 'a',
      index: 'a0',
      name: 'Square',
      props: { x: 0, y: 0, width: 100, height: 100, shape: { kind: 'rect' }, fills: [] },
    },
    words: {
      type: 'text',
      parentId: 'sq',
      link: 'words',
      index: 'a1',
      name: 'Words',
      props: { x: 0, y: 200, width: 200, height: 40, text: 'Hello', boxMode: 'fixed', style: STYLE },
    },
    heading: {
      type: 'text',
      parentId: 'sq',
      link: 'heading',
      index: 'a2',
      name: 'Heading',
      props: { x: 0, y: 300, width: 200, height: 40, text: 'Title', boxMode: 'fixed', style: STYLE },
      bindings: { fontFamily: 'brand:heading' },
    },
    photo: {
      type: 'graphic',
      parentId: 'sq',
      link: 'photo',
      index: 'a3',
      name: 'Photo',
      props: {
        ...{ x: 0, y: 400, width: 100, height: 100, shape: { kind: 'rect' } },
        fills: [{ type: 'image', assetId: 'photo', fit: 'fill', opacity: 1 }],
      },
    },
  },
}
/** The Headline text style's look, in the kit's heading family. */
const HEADLINE: TextLook = {
  fontFamily: 'Noto Sans',
  fontWeight: 700,
  fontStyle: 'normal',
  lineHeight: 1.1,
  letterSpacing: { unit: 'percent', value: -1 },
}
const KIT: Variables = {
  'brand:primary': '#FF0000FF',
  'brand:heading': 'Noto Sans',
  'brand:logo': 'logo-1',
  'brand:headline': HEADLINE,
}

/** A family the app does not ship, whose file is the shipped extra bold Noto Sans, wider than the regular. */
const KIT_FAMILY = 'Brand Display'
const BOUND = { fontFamily: 'Noto Sans', fontSize: 72, fontWeight: 400, color: '#111111FF' }
/** A text in the square bound to the brand's heading font. */
const bound = (index: string, props: Record<string, unknown>) => ({
  type: 'text' as const,
  parentId: 'sq',
  index,
  name: index,
  bindings: { fontFamily: 'brand:heading' as const },
  props: { style: BOUND, ...props } as unknown as TextProps,
})
/**
 * Text bound to the heading font in the square, each copied into a linked story frame: a box that
 * grows wide with its words (smaller in the story), one that grows down, a fixed one and a fixed one
 * that shrinks its words to fit.
 */
const BRAND_TEXT: DesignInput = linkedFrames(
  frameDesign({
    name: 'Brand font',
    nodes: {
      wide: bound('a0', { x: 60, y: 100, width: 420, height: 98, boxMode: 'autoWidth', text: 'Summer sale' }),
      shrink: bound('a1', {
        x: 60,
        y: 400,
        width: 460,
        height: 200,
        boxMode: 'fixed',
        shrinkToFit: { min: 12, max: 72 },
        text: 'Cold brew, three ways, every single morning of the week',
      }),
      tall: bound('a2', {
        x: 720,
        y: 100,
        width: 320,
        height: 98,
        boxMode: 'autoHeight',
        text: 'Fresh beans roasted daily',
      }),
      fixed: bound('a3', { x: 600, y: 700, width: 400, height: 240, boxMode: 'fixed', text: 'Open late on Fridays' }),
    },
  }),
  [{ id: 'story', name: 'Story', width: 1080, height: 1920, values: { wide: { style: { ...BOUND, fontSize: 48 } } } }],
)

/**
 * The brand kit on a real session and selection, with bytes that gain a family's files when its
 * load is let go, unless it is one of `failing`, logging what it asks of resources, the view and typing.
 */
function harness(failing: string[] = []) {
  const session = sessionOf(DESIGN)
  const log: string[] = []
  const selection = editorSelection({ drawn: () => session.design(), frames: () => [], changed: () => {} })
  let bytes: ResourceBytes = { fonts: [], fallbackFamilies: [], images: {}, variables: KIT }
  /** Lets every family load asked for so far arrive. */
  const arrivals: (() => void)[] = []
  const arrive = () => {
    for (const done of arrivals.splice(0)) done()
  }
  const deps: BrandKitDeps = {
    session,
    resources: {
      bytes: () => bytes,
      setVariables: (variables) => {
        log.push('setVariables')
        bytes = { ...bytes, variables }
      },
      loadFamilies: (families) => {
        log.push(`load ${families.join(',')}`)
        return families.map(
          (family) =>
            new Promise<void>((resolve) =>
              arrivals.push(() => {
                if (!failing.includes(family))
                  bytes = { ...bytes, fonts: [...bytes.fonts, { family, bytes: new Uint8Array() }] }
                resolve()
              }),
            ),
        )
      },
    },
    view: { redraw: () => log.push('redraw') },
    selection,
    typing: { fitText: (id) => log.push(`fit ${id}`) },
    signal: new AbortController().signal,
  }
  const kit = editorBrandKit(deps)
  const select = (ids: string[]) => selection.select(ids, 'sq')
  return { kit, session, log, select, arrive }
}

describe('editorBrandKit', () => {
  describe('setVariables', () => {
    it('gives bound properties the new values, loads the brand fonts and redraws', async () => {
      const { kit, session, log, arrive } = harness()
      const done = kit.setVariables({ ...KIT, 'brand:heading': 'Inter' })
      arrive()
      await done
      expect(log.slice(0, 3)).toEqual(['setVariables', 'load Inter,Noto Sans', 'redraw'])
      expect(session.design().nodes.heading?.props).toMatchObject({ style: { fontFamily: 'Inter' } })
    })

    it('refits the text bound to a brand font whose family changed, in every frame, in its real files; an undo after leaves the refit', async () => {
      const extraBold = loadFontFiles().find((f) => f.file === 'NotoSans-ExtraBold.ttf')?.bytes ?? new Uint8Array()
      const editor = await testEditor(BRAND_TEXT, {
        sources: {
          fontFiles: (families) =>
            Promise.resolve(
              families.includes(KIT_FAMILY)
                ? [{ family: KIT_FAMILY, weight: 400, style: 'normal' as const, bytes: extraBold }]
                : [],
            ),
        },
      })
      const { core } = editor
      const props = (id: string) => core.design().nodes[id]?.props as TextProps
      const sizes = () => ({
        wide: props('wide').width,
        story: props(copyIn('story', 'wide')).width,
        tall: props('tall').height,
      })
      const before = sizes()
      // A step to undo after the kit changes.
      core.select(['fixed'])
      editor.press('nudgeRight')
      await core.setVariables({ 'brand:heading': KIT_FAMILY })
      for (const id of ['wide', 'tall', 'fixed', 'shrink', copyIn('story', 'wide')])
        expect(props(id).style.fontFamily, id).toBe(KIT_FAMILY)
      const after = sizes()
      expect(after.wide).not.toBe(before.wide)
      expect(after.story).not.toBe(before.story)
      expect(after.tall).not.toBe(before.tall)
      expect(props('fixed')).toMatchObject({ x: 601, width: 400, height: 240 })
      expect(props('shrink')).toMatchObject({ width: 460, height: 200 })
      editor.press('undo')
      expect(props('fixed').x).toBe(600)
      expect(props('wide').style.fontFamily).toBe(KIT_FAMILY)
      expect(sizes()).toEqual(after)
      editor.end()
    })
  })

  describe('bindSelection', () => {
    it('binds a text’s colour and any other layer’s fill to a brand colour, in one undo step', () => {
      const { kit, session, select } = harness()
      select(['a', 'words'])
      expect(kit.bindSelection('color', 'brand:primary')).toBe(2)
      expect(session.design().nodes.a?.bindings).toEqual({ fill: 'brand:primary' })
      expect(session.design().nodes.words?.bindings).toEqual({ textColor: 'brand:primary' })
      session.undo()
      expect(session.design().nodes.a?.bindings).toBeUndefined()
      expect(session.design().nodes.words?.bindings).toBeUndefined()
    })

    it('binds only text to a brand font, fitting it in its new family', () => {
      const { kit, session, log, select } = harness()
      select(['a', 'words'])
      expect(kit.bindSelection('font', 'brand:heading')).toBe(1)
      expect(session.design().nodes.words?.bindings).toEqual({ fontFamily: 'brand:heading' })
      expect(log).toEqual(['fit words'])
    })

    it('unbinds with null', () => {
      const { kit, session, select } = harness()
      select(['heading'])
      expect(kit.bindSelection('font', null)).toBe(1)
      expect(session.design().nodes.heading?.bindings?.fontFamily).toBeUndefined()
    })

    it('unbinds a fill and a text whose stored colours lag the kit, storing the kit’s colour each showed', () => {
      const { kit, session, select } = harness()
      session.run('node.bind', { ids: ['a'], property: 'fill', ref: 'brand:primary', value: '#123456FF' })
      session.run('node.bind', { ids: ['words'], property: 'textColor', ref: 'brand:primary', value: '#123456FF' })
      select(['a', 'words'])
      expect(kit.bindSelection('color', null)).toBe(2)
      const { a, words } = session.design().nodes
      expect(a).toMatchObject({ props: { fills: [{ color: '#FF0000FF' }] } })
      expect(words).toMatchObject({ props: { style: { color: '#FF0000FF' } } })
      expect([a?.bindings, words?.bindings]).toEqual([undefined, undefined])
    })

    it('binds the picture of the selected layers that show one to the logo, in one undo step, and unbinds it', () => {
      const { kit, session, select } = harness()
      select(['a', 'words', 'photo'])
      expect(kit.bindSelection('image', 'brand:logo')).toBe(1)
      expect(session.design().nodes.photo).toMatchObject({
        bindings: { image: 'brand:logo' },
        props: { fills: [{ type: 'image', assetId: 'logo-1' }] },
      })
      expect([session.design().nodes.a?.bindings, session.design().nodes.words?.bindings]).toEqual([
        undefined,
        undefined,
      ])
      select(['photo'])
      expect(kit.bindSelection('image', null)).toBe(1)
      expect(session.design().nodes.photo?.bindings).toBeUndefined()
      session.undo()
      session.undo()
      expect(session.design().nodes.photo).toMatchObject({ props: { fills: [{ assetId: 'photo' }] } })
      expect(session.design().nodes.photo?.bindings).toBeUndefined()
    })

    it('binds only text to a brand text style, ending its font binding, fitting it in its new look, in one undo step', () => {
      const { kit, session, log, select } = harness()
      select(['a', 'words', 'heading'])
      expect(kit.bindSelection('textLook', 'brand:headline')).toBe(2)
      for (const id of ['words', 'heading'])
        expect(session.design().nodes[id]).toMatchObject({
          bindings: { textStyle: 'brand:headline' },
          props: { style: { ...HEADLINE, fontSize: 20, color: '#000000FF' } },
        })
      expect(session.design().nodes.heading?.bindings).toEqual({ textStyle: 'brand:headline' })
      expect(session.design().nodes.a?.bindings).toBeUndefined()
      expect(log).toEqual(['fit words', 'fit heading'])
      session.undo()
      expect(session.design().nodes.heading?.bindings).toEqual({ fontFamily: 'brand:heading' })
      expect(session.design().nodes.words?.props).toMatchObject({ style: STYLE })
    })

    it('unbinds a text whose stored look lags the kit, storing the look it showed', () => {
      const { kit, session, select } = harness()
      session.run('node.bind', {
        ids: ['words'],
        property: 'textStyle',
        ref: 'brand:headline',
        value: { ...HEADLINE, fontWeight: 300 },
      })
      select(['words'])
      expect(kit.bindSelection('textLook', null)).toBe(1)
      expect(session.design().nodes.words).toMatchObject({ props: { style: { fontWeight: 700 } } })
      expect(session.design().nodes.words?.bindings).toBeUndefined()
    })

    it('changes nothing for a value the kit doesn’t have, or with nothing selected', () => {
      const { kit, session, select } = harness()
      expect(kit.bindSelection('color', 'brand:primary')).toBe(0)
      select(['a'])
      expect(kit.bindSelection('color', 'brand:missing')).toBe(0)
      expect(session.canUndo()).toBe(false)
    })
  })

  describe('refitBrandText', () => {
    it('gives text bound to a brand font the kit’s new family once its files are here, a change no one undoes', async () => {
      const { kit, session, log, arrive } = harness()
      const unbound = session.design().nodes.words
      const done = kit.setVariables({ ...KIT, 'brand:heading': 'Inter' })
      expect(session.design().nodes.heading?.props).toMatchObject({ style: { fontFamily: 'Noto Sans' } })
      arrive()
      await done
      expect(session.design().nodes.heading?.props).toMatchObject({ style: { fontFamily: 'Inter' } })
      expect(session.design().nodes.words).toEqual(unbound)
      expect(log).toContain('fit heading')
      expect(session.canUndo()).toBe(false)
    })

    it('waits for a step left open while the files come, such as typing, and refits as it ends (C40)', async () => {
      const { kit, session, log, arrive } = harness()
      const typing = session.beginGesture()
      session.run('node.update', { ids: ['words'], patch: { x: 3 } })
      const done = kit.setVariables({ ...KIT, 'brand:heading': 'Inter' })
      arrive()
      await done
      expect(session.design().nodes.heading?.props).toMatchObject({ style: { fontFamily: 'Noto Sans' } })
      expect(log).not.toContain('fit heading')
      typing.end()
      expect(session.design().nodes.heading?.props).toMatchObject({ style: { fontFamily: 'Inter' } })
      expect(log).toContain('fit heading')
      // The typing is one step to undo, and the refit no one's.
      session.undo()
      expect(session.design().nodes.words?.props.x).not.toBe(3)
      expect(session.design().nodes.heading?.props).toMatchObject({ style: { fontFamily: 'Inter' } })
      expect(session.canUndo()).toBe(false)
    })

    it('leaves the text be when the family’s files don’t come', async () => {
      const { kit, session, log, arrive } = harness(['Inter'])
      const done = kit.setVariables({ ...KIT, 'brand:heading': 'Inter' })
      arrive()
      await done
      expect(session.design().nodes.heading?.props).toMatchObject({ style: { fontFamily: 'Noto Sans' } })
      expect(log).not.toContain('fit heading')
    })

    it('does nothing when every bound text has its brand family and look', async () => {
      const { kit, log, select } = harness()
      select(['words'])
      kit.bindSelection('textLook', 'brand:headline')
      log.length = 0
      await kit.refitBrandText()
      expect(log).toEqual([])
    })

    it('gives text bound to a brand text style the kit’s new look once its family’s files are here, a change no one undoes', async () => {
      const { kit, session, log, select, arrive } = harness()
      select(['words'])
      kit.bindSelection('textLook', 'brand:headline')
      const look = { ...HEADLINE, fontFamily: 'Inter', fontStyle: 'italic', textCase: 'upper' } as const
      const done = kit.setVariables({ ...KIT, 'brand:headline': look })
      expect(session.design().nodes.words?.props).toMatchObject({ style: { fontFamily: 'Noto Sans' } })
      arrive()
      await done
      expect(session.design().nodes.words).toMatchObject({
        bindings: { textStyle: 'brand:headline' },
        props: { style: { ...look, fontSize: 20 } },
      })
      expect(log).toContain('fit words')
      // The binding is one step to undo, and the new look no one's.
      session.undo()
      expect(session.design().nodes.words?.bindings).toBeUndefined()
      expect(session.canUndo()).toBe(false)
    })

    it('restyles text bound to a style whose font is not set in the text’s own family, at once', async () => {
      const { kit, session, log, select } = harness()
      select(['words'])
      kit.bindSelection('textLook', 'brand:headline')
      const look: TextLook = { fontWeight: 300, fontStyle: 'normal', letterSpacing: { unit: 'percent', value: -1 } }
      await kit.setVariables({ ...KIT, 'brand:headline': look })
      expect(session.design().nodes.words?.props).toMatchObject({ style: { fontFamily: 'Noto Sans', fontWeight: 300 } })
      expect(log).toContain('fit words')
    })

    it('leaves a text bound to a style be when the family’s files don’t come', async () => {
      const { kit, session, select, arrive } = harness(['Inter'])
      select(['words'])
      kit.bindSelection('textLook', 'brand:headline')
      const done = kit.setVariables({ ...KIT, 'brand:headline': { ...HEADLINE, fontFamily: 'Inter', fontWeight: 300 } })
      arrive()
      await done
      expect(session.design().nodes.words?.props).toMatchObject({ style: { fontFamily: 'Noto Sans', fontWeight: 700 } })
    })
  })

  describe('followBrandLogo', () => {
    it('gives pictures bound to the logo the kit’s new logo, a change no one undoes, so a crop acts on the picture drawn', () => {
      const { kit, session, select } = harness()
      select(['photo'])
      kit.bindSelection('image', 'brand:logo')
      const unbound = session.design().nodes.a
      void kit.setVariables({ ...KIT, 'brand:logo': 'logo-2' })
      expect(session.design().nodes.photo).toMatchObject({
        bindings: { image: 'brand:logo' },
        props: { fills: [{ type: 'image', assetId: 'logo-2' }] },
      })
      expect(session.design().nodes.a).toEqual(unbound)
      // The binding is one step to undo, and the new logo no one's.
      session.undo()
      expect(session.design().nodes.photo?.bindings).toBeUndefined()
      expect(session.canUndo()).toBe(false)
    })

    it('leaves a picture as it stores it while the kit gives no logo', () => {
      const { kit, session, select } = harness()
      select(['photo'])
      kit.bindSelection('image', 'brand:logo')
      void kit.setVariables({ 'brand:primary': '#FF0000FF', 'brand:heading': 'Noto Sans' })
      kit.followBrandLogo()
      expect(session.design().nodes.photo).toMatchObject({ props: { fills: [{ assetId: 'logo-1' }] } })
    })
  })
})
