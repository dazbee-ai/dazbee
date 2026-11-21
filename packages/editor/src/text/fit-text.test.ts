// The editor's half of the recompute (D6): a text measured as typing measures it, waiting only
// while a font it is drawn in is on its way, and measured with what is here once that load settles.
import { afterEach, describe, expect, it } from 'vitest'

import { type Client, derivedValues, fittedText, openClient } from '@dazbee/doc'
import { DesignState, firstSaved, openServer, type Outgoing, type Server } from '@dazbee/doc/sync'
import { EMOJI_FAMILY } from '@dazbee/fonts'
import { loadFontFiles } from '@dazbee/fonts/node'
import { emojiTestFont, TEST_EMOJI } from '@dazbee/fonts/test-fonts'
import { type DesignRecords, type Layer, PROTOCOL, type ServerMessage, type TextProps } from '@dazbee/schema'

import type { FontSources, ListedFace } from '../font-loads.ts'
import { WORDS } from '../test-actions.ts'
import { type TestEditor, testEditor } from '../test-editor.ts'
import { editorFitText } from './fit-text.ts'

/** A font file of a family we don't ship, which looks unlike the fallbacks. */
const WIDE = loadFontFiles().find((f) => f.file === 'NotoSans-ExtraBold.ttf')?.bytes ?? new Uint8Array()

/** A font catalog whose answers a test settles, one at a time, in order; a face's file comes at once. */
function slowFonts(bytes = WIDE) {
  const asked: string[][] = []
  const loads: { families: string[]; resolve: (faces: ListedFace[]) => void; reject: (error: Error) => void }[] = []
  const sources: FontSources = {
    fontFaces: (families: string[]) => {
      asked.push(families)
      return new Promise<ListedFace[]>((resolve, reject) => loads.push({ families, resolve, reject }))
    },
    fontFile: () => Promise.resolve(bytes),
  }
  return {
    asked,
    sources,
    /** Settles the oldest load with an upright 400 face of each family it asked for, or none. */
    bring(withFaces = true) {
      const load = loads.shift()
      const faces = withFaces
        ? (load?.families ?? []).map((family) => ({ id: family, family, weight: 400, style: 'normal' as const }))
        : []
      load?.resolve(faces)
    },
    fail() {
      loads.shift()?.reject(new Error('the font store is down'))
    },
  }
}

let editor: TestEditor | undefined
afterEach(() => editor?.end())

/** The words layer of the editor's design, growing with its words, in `family`. */
function wordsIn(family: string, more: Partial<Layer> = {}): Layer {
  const words = editor?.core.design().nodes.words as Layer & { props: TextProps }
  return {
    ...words,
    ...more,
    props: { ...words.props, boxMode: 'autoWidth', style: { ...words.props.style, fontFamily: family } },
  } as Layer
}

const settled = () => new Promise((resolve) => setTimeout(resolve, 0))

/** A message as it arrives: through JSON. */
const wire = <T>(message: T): T => JSON.parse(JSON.stringify(message)) as T

/** Two tabs on a sync server in memory, each recomputing with `recompute`. */
function twoTabs(records: DesignRecords, recompute: ReturnType<typeof derivedValues>) {
  const server = openServer(
    { saved: firstSaved(records, 's0'), journal: [], lastEntry: 0 },
    { hashSecret: (secret) => secret },
  )
  const who = { member: { userId: 'ann', workspaceId: 'w1' }, name: 'ann', access: 'edit' as const }
  const join = () => {
    const joined = server.join(wire({ type: 'hello', protocol: PROTOCOL, token: 't', waiting: 0 }), who)
    if ('close' in joined) throw new Error(joined.reason)
    return openClient(wire(joined.out[0]?.message as ServerMessage), { recompute })
  }
  return { server, tabs: [join(), join()] as const }
}

/** Sends `messages` from `tab` to the server; what it answers. */
function send(server: Server, tab: Client, messages: readonly unknown[]): Outgoing[] {
  return messages.flatMap((message) => {
    const text = JSON.stringify(message)
    const answer = server.receive(tab.tabId(), JSON.parse(text), Buffer.byteLength(text))
    if ('close' in answer) throw new Error(answer.reason)
    return answer
  })
}

/** What `tab` sends on hearing what in `out` is for it. */
const deliver = (tab: Client, out: readonly Outgoing[]) =>
  out.flatMap(({ to, except, message }) =>
    (to === 'all' || to === tab.tabId()) && except !== tab.tabId() ? tab.receive(wire(message)) : [],
  )

/** Sends what each tab gives to the server, and what it answers to every tab, until nothing more is sent. */
function exchange(server: Server, sends: [Client, readonly unknown[]][], tabs: readonly Client[]) {
  let waiting = sends
  while (waiting.length > 0) {
    const next: [Client, readonly unknown[]][] = []
    for (const [from, sent] of waiting) {
      const out = send(server, from, sent)
      for (const tab of tabs) next.push([tab, deliver(tab, out)])
    }
    waiting = next.filter(([, sent]) => sent.length > 0)
  }
}

describe('editorFitText', () => {
  it('fits a text in a loaded font as typing fits it', async () => {
    editor = await testEditor(WORDS)
    const { scenes, resources } = editor.modules
    const fit = editorFitText({ scenes, resources })
    const layer = wordsIn('Noto Sans')
    expect(fit(layer)).toEqual(fittedText(layer, scenes.measure(), resources.bytes().variables))
  })

  it('waits for a font on its way, asking for it once, then fits in it once it is here', async () => {
    const fonts = slowFonts()
    editor = await testEditor(WORDS, { sources: fonts.sources })
    const { scenes, resources } = editor.modules
    const fit = editorFitText({ scenes, resources })
    let settles = 0
    resources.onSettle(() => settles++)
    const layer = wordsIn('Late')
    const fallback = fittedText(layer, scenes.measure(), undefined)
    expect(fit(layer)).toBe('wait')
    expect(fit(layer)).toBe('wait')
    expect(fonts.asked).toEqual([['Late']])
    fonts.bring()
    await settled()
    expect(settles).toBe(1)
    const size = fit(layer)
    expect(size).toEqual(fittedText(layer, scenes.measure(), undefined))
    expect(size).not.toEqual(fallback)
  })

  it('waits for the brand font a text is bound to, in the family the kit gives it', async () => {
    const fonts = slowFonts()
    editor = await testEditor(WORDS, { sources: fonts.sources })
    const { scenes, resources } = editor.modules
    resources.setVariables({ 'brand:heading': 'Kit' })
    const fit = editorFitText({ scenes, resources })
    // Its own family is drawn in no more, so nothing waits for it.
    const layer = wordsIn('Unbound', { bindings: { fontFamily: 'brand:heading' } } as Partial<Layer>)
    expect(fit(layer)).toBe('wait')
    expect(fonts.asked).toEqual([['Kit']])
    fonts.bring()
    await settled()
    expect(fit(layer)).not.toBe('wait')
  })

  it('waits for the emoji font a text’s emoji need, asking for it once, then fits in it', async () => {
    const fonts = slowFonts(emojiTestFont())
    const { asked } = fonts
    const bring = () => fonts.bring()
    editor = await testEditor(WORDS, { sources: fonts.sources })
    const { scenes, resources } = editor.modules
    const fit = editorFitText({ scenes, resources })
    const plain = wordsIn('Noto Sans')
    const layer = { ...plain, props: { ...plain.props, text: `Party ${TEST_EMOJI}` } } as Layer
    const boxes = fittedText(layer, scenes.measure(), undefined)
    expect(fit(layer)).toBe('wait')
    expect(fit(plain)).not.toBe('wait')
    expect(asked).toEqual([[EMOJI_FAMILY]])
    bring()
    await settled()
    const size = fit(layer)
    expect(size).toEqual(fittedText(layer, scenes.measure(), undefined))
    expect(size).not.toEqual(boxes)
  })

  it('waits for nothing and asks for no font for a fixed box, or a layer that is no text', async () => {
    const fonts = slowFonts()
    editor = await testEditor(WORDS, { sources: fonts.sources })
    const { scenes, resources } = editor.modules
    const fit = editorFitText({ scenes, resources })
    const fixed = wordsIn('Late')
    expect(fit({ ...fixed, props: { ...fixed.props, boxMode: 'fixed' } } as Layer)).toBeUndefined()
    expect(fit(editor.core.design().nodes.a as Layer)).toBeUndefined()
    expect(fonts.asked).toEqual([])
  })

  it('fits with the fallbacks once a font’s load brings no files, or fails while connected', async () => {
    const fonts = slowFonts()
    editor = await testEditor(WORDS, { sources: fonts.sources })
    const { scenes, resources } = editor.modules
    const fit = editorFitText({ scenes, resources })
    let settles = 0
    resources.onSettle(() => settles++)
    const none = wordsIn('Nowhere')
    expect(fit(none)).toBe('wait')
    fonts.bring(false)
    await settled()
    expect(fit(none)).toEqual(fittedText(none, scenes.measure(), undefined))
    const failing = wordsIn('Broken')
    expect(fit(failing)).toBe('wait')
    fonts.fail()
    await settled()
    expect(fit(failing)).toEqual(fittedText(failing, scenes.measure(), undefined))
    expect(settles).toBe(2)
  })

  it('ends two tabs’ crossing edits on a growing text with the box typing gives, once its font is here', async () => {
    const fonts = slowFonts()
    editor = await testEditor(WORDS, { sources: fonts.sources })
    const { scenes, resources } = editor.modules
    const records = JSON.parse(JSON.stringify(editor.core.design())) as DesignRecords
    records.nodes.words = wordsIn('Late') as never
    const { server, tabs } = twoTabs(records, derivedValues(editorFitText({ scenes, resources })))
    const [a, b] = tabs
    const step = (tab: Client, prop: string, to: unknown) => {
      tab.open()
      tab.write({ op: 'set', value: { part: 'layer', id: 'words', key: 'props', prop }, to } as never)
      return tab.end(null)
    }
    // From the same design, one tab makes the text wrap at its width and the other makes it bigger:
    // the box fits neither change alone.
    const fromA = step(a, 'boxMode', 'autoHeight')
    const fromB = step(b, 'style', {
      ...(records.nodes.words as Layer & { props: TextProps }).props.style,
      fontSize: 140,
    })
    // Both reach the server before either tab hears of the other's.
    const [outA, outB] = [send(server, a, fromA), send(server, b, fromB)]
    for (const tab of tabs) expect([...deliver(tab, outA), ...deliver(tab, outB)]).toEqual([])
    expect(tabs.map((tab) => tab.owes())).toContain(true)
    // The font comes: the tab that owes the follow-up sends it, and both end on the box typing gives.
    fonts.bring()
    await settled()
    exchange(
      server,
      tabs.map((tab) => [tab, tab.retryFollowUps()]),
      tabs,
    )
    const merged = DesignState.fromRecords(a.working().toRecords()).get('layer', 'words') as unknown as Layer
    const size = fittedText(merged, scenes.measure(), undefined)
    for (const tab of tabs) {
      expect(tab.owes()).toBe(false)
      expect(tab.working().get('layer', 'words')?.props).toMatchObject({ width: size?.width, height: size?.height })
    }
    expect(merged.props).toMatchObject({ boxMode: 'autoHeight', style: { fontSize: 140 } })
    expect(size).not.toEqual(fittedText(wordsIn('Late'), scenes.measure(), undefined))
  })

  it('gives the doc’s recompute the box typing would give, once the font is here', async () => {
    const fonts = slowFonts()
    editor = await testEditor(WORDS, { sources: fonts.sources })
    const { scenes, resources } = editor.modules
    const recompute = derivedValues(editorFitText({ scenes, resources }))
    const records = JSON.parse(JSON.stringify(editor.core.design())) as DesignRecords
    records.nodes.words = wordsIn('Late') as never
    const state = DesignState.fromRecords(records)
    expect(recompute(state, new Set(['layer/words']))).toBe('wait')
    fonts.bring()
    await settled()
    const size = fittedText(wordsIn('Late'), scenes.measure(), undefined)
    const changes = recompute(state, new Set(['layer/words']))
    expect(changes).toContainEqual({
      op: 'set',
      value: { part: 'layer', id: 'words', key: 'props', prop: 'width' },
      to: size?.width,
    })
  })
})
