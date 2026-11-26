import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { Editor } from '@dazbee/editor'

import { BRIEF_DRAFTS } from '@/lib/editor/brief-draft.ts'
import { I18nProvider } from '@/lib/i18n/client.tsx'
import { en } from '@/lib/i18n/en.ts'

import { BriefBox } from './brief-box.tsx'

/** An editor as the box reads it before anything is sent: the design's size, well within its limits. */
const editor = () =>
  ({
    designSize: () => ({ layers: 10, frames: 2, pages: 1, sections: 0, connectors: 0, bytes: 2000 }),
  }) as unknown as Editor

/** The box's markup in English for `on`, with no tooltip provider of the page's around it. */
const boxHtml = (on: Editor) =>
  renderToStaticMarkup(
    createElement(I18nProvider, {
      locale: 'en',
      children: createElement(BriefBox, { workspaceId: 'w1', brandId: 'b1', editor: on, onClose: () => {} }),
    }),
  )

describe('BriefBox', () => {
  it('keeps its tooltips in a row of their own, which the page’s other tooltips can’t hold back', () => {
    // Its own provider: it renders with none of the page's around it.
    expect(boxHtml(editor())).toContain('data-testid="brief-box"')
  })

  it('gives its words field and every button a focus of their own, which the app’s ring leaves alone', () => {
    const html = boxHtml(editor())
    const controls = html.match(/<(?:button|textarea)\b[^>]*>/g) ?? []
    expect(controls.length).toBeGreaterThan(4)
    expect(controls.filter((tag) => !tag.includes('data-own-focus'))).toEqual([])
    const globals = readFileSync(join(import.meta.dirname, '..', '..', 'app', 'globals.css'), 'utf8')
    expect(globals).toMatch(/:focus-visible:not\(\[data-own-focus\]\)\s*\{\s*outline: 2px solid var\(--ring\)/)
    expect(globals).not.toMatch(/^:focus-visible \{/m)
  })

  it('shows its controls as icons named for the person, with no words of their own to cut', () => {
    const html = boxHtml(editor())
    expect(html).toContain(`aria-label="${en.editor.brief.fast}"`)
    expect(html).toContain(`aria-label="${en.editor.brief.make}"`)
    expect(html).not.toMatch(/>\s*(?:Fast|Precise|Make drafts)\s*</)
  })

  it('opens again with the words, line breaks kept, and the speed it was closed with', () => {
    const on = editor()
    BRIEF_DRAFTS.set(on, { words: 'Cold brew launch\nWarm tones', pictures: [], sizeId: 'story', mode: 'precise' })
    const html = boxHtml(on)
    expect(html).toContain('Cold brew launch\nWarm tones</textarea>')
    expect(html).toContain(`aria-label="${en.editor.brief.precise}"`)
    expect(html).toContain('Story and Reel')
  })
})
