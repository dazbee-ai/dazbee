import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { ARTWORK_SET_IDS, ARTWORK_SETS, artworkPinOf } from './artwork-sets.ts'
import { SET_NOTICES } from './notices.ts'
import {
  ICON_SET_IDS,
  ICON_SETS,
  ILLUSTRATION_SET_IDS,
  ILLUSTRATION_SETS,
  pinOf,
  STICKER_SET_IDS,
  STICKER_SETS,
} from './sets.ts'

const PACKAGE = join(import.meta.dirname, '..')
/** A file of this package as text, its line ends as LF whatever the checkout wrote. */
const read = (...path: string[]) => readFileSync(join(PACKAGE, ...path), 'utf8').replaceAll(/\r\n/g, '\n')
/** The icon sets' notices, then the sticker sets', the illustration sets' and the artwork sets'. */
const icons = SET_NOTICES.slice(0, ICON_SET_IDS.length)
const stickers = SET_NOTICES.slice(ICON_SET_IDS.length, ICON_SET_IDS.length + STICKER_SET_IDS.length)
const illustrations = SET_NOTICES.slice(
  ICON_SET_IDS.length + STICKER_SET_IDS.length,
  ICON_SET_IDS.length + STICKER_SET_IDS.length + ILLUSTRATION_SET_IDS.length,
)
const artwork = SET_NOTICES.slice(ICON_SET_IDS.length + STICKER_SET_IDS.length + ILLUSTRATION_SET_IDS.length)

describe('SET_NOTICES', () => {
  it('lists the icon sets, then the sticker sets, the illustration sets and the artwork sets', () => {
    expect(SET_NOTICES.map(({ title }) => title)).toEqual([
      'Tabler Icons',
      'Phosphor Icons',
      'Fluent Emoji',
      'Open Peeps',
      'Humaaans',
      'Open Doodles',
      'unDraw',
      'ManyPixels Chromablue',
      'ManyPixels Birdview',
      'Streamline Kameleon',
      'Streamline Plump',
      'Streamline Freehand',
      'Streamline Stickies',
      '3dicons',
      'Coolshapes',
      'dddoodle',
      'Kenney Particle Pack',
      'Kenney Smoke Particles',
      'Pattern Monster',
    ])
  })

  it('names each icon set at the version this package pins, with the licence its package ships', () => {
    const pins = (JSON.parse(read('package.json')) as { devDependencies: Record<string, string> }).devDependencies
    for (const [i, id] of ICON_SET_IDS.entries()) {
      const { npm } = ICON_SETS[id]
      const installed = JSON.parse(read('node_modules', npm, 'package.json')) as { version: string; license: string }
      const notice = icons[i]
      expect(notice).toMatchObject({ version: pins[npm], licence: installed.license })
      expect(installed.version).toBe(pins[npm])
      expect(notice?.text).toBe(read('node_modules', npm, 'LICENSE'))
      expect(notice?.text).toBe(read('sets', id, 'LICENSE'))
    }
  })

  it('names each sticker set at its pin, with the licence kept beside its files', () => {
    for (const [i, id] of STICKER_SET_IDS.entries()) {
      const set = STICKER_SETS[id]
      const notice = stickers[i]
      expect(notice).toMatchObject({ version: pinOf(set), licence: set.licence, homepage: set.homepage })
      expect(notice?.text).toBe(read('sets', id, 'LICENSE'))
    }
    expect(stickers[0]?.paragraphs.slice(0, 2)).toEqual(['MIT License', 'Copyright (c) Microsoft Corporation.'])
  })

  it('gives each CC0 set its makers’ words, then the CC0 legal code in full', () => {
    for (const [i, id] of STICKER_SET_IDS.entries()) {
      const { licence, dedication } = STICKER_SETS[id]
      if (licence !== 'CC0-1.0') continue
      const [first, ...rest] = stickers[i]?.paragraphs ?? []
      expect(first).toBe(dedication)
      expect(rest.slice(0, 2)).toEqual(['Creative Commons Legal Code', 'CC0 1.0 Universal'])
      expect(rest.join(' ')).toContain('Affirmer hereby overtly, fully, permanently, irrevocably and unconditionally')
    }
  })

  it('names each illustration set at its pin, its licence quoted from the page its notice links to', () => {
    for (const [i, id] of ILLUSTRATION_SET_IDS.entries()) {
      const set = ILLUSTRATION_SETS[id]
      const notice = illustrations[i]
      expect(notice).toMatchObject({ version: pinOf(set), licence: set.licence.name, homepage: set.homepage })
      expect(notice?.paragraphs[0]).toContain(`read at ${set.licence.url} on `)
      expect(notice?.paragraphs.join(' ')).toContain('can be used for free')
    }
  })

  it('credits each artwork set’s creator, linking to their site, at its pin, with its licence in full', () => {
    for (const [i, id] of ARTWORK_SET_IDS.entries()) {
      const set = ARTWORK_SETS[id]
      const notice = artwork[i]
      expect(notice).toMatchObject({ version: artworkPinOf(set), licence: set.licence.name, creator: set.creator })
      expect(notice?.paragraphs[0]).toContain(
        `by ${set.creator.name} (${set.creator.url}). Used under ${set.licence.name}`,
      )
      const text = notice?.paragraphs.join(' ') ?? ''
      if (set.licence.spdx === 'CC-BY-4.0')
        expect(text).toContain('Creative Commons Attribution 4.0 International Public License')
      if (set.licence.spdx === 'CC0-1.0') expect(text).toContain('CC0 1.0 Universal')
      if (set.licence.spdx === 'MIT') expect(text).toContain('Permission is hereby granted, free of charge')
    }
  })

  it('gives each licence as paragraphs, each one line, with every word of the text in order', () => {
    for (const { text, paragraphs } of SET_NOTICES) {
      expect(paragraphs.length).toBeGreaterThanOrEqual(4)
      for (const paragraph of paragraphs) expect(paragraph).not.toMatch(/\n/)
      expect(paragraphs.join(' ').split(' ')).toEqual(text.split(/\s+/).filter(Boolean))
    }
    for (const { paragraphs } of icons) {
      expect(paragraphs[0]).toBe('MIT License')
      expect(paragraphs).toHaveLength(5)
    }
  })
})
