import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { ICON_SET_NOTICES } from './notices.ts'
import { ICON_SET_IDS, ICON_SETS } from './sets.ts'

const PACKAGE = join(import.meta.dirname, '..')
/** A file of this package as text, its line ends as LF whatever the checkout wrote. */
const read = (...path: string[]) => readFileSync(join(PACKAGE, ...path), 'utf8').replaceAll(/\r\n/g, '\n')

describe('ICON_SET_NOTICES', () => {
  it('names each set at the version this package pins, with the licence its package ships', () => {
    const pins = (JSON.parse(read('package.json')) as { devDependencies: Record<string, string> }).devDependencies
    expect(ICON_SET_NOTICES.map(({ title }) => title)).toEqual(['Tabler Icons', 'Phosphor Icons'])
    for (const [i, id] of ICON_SET_IDS.entries()) {
      const { npm } = ICON_SETS[id]
      const installed = JSON.parse(read('node_modules', npm, 'package.json')) as { version: string; license: string }
      const notice = ICON_SET_NOTICES[i]
      expect(notice).toMatchObject({ version: pins[npm], licence: installed.license })
      expect(installed.version).toBe(pins[npm])
      expect(notice?.text).toBe(read('node_modules', npm, 'LICENSE'))
      expect(notice?.text).toBe(read('sets', id, 'LICENSE'))
    }
  })

  it('gives each licence as paragraphs, each one line, with every word of the text in order', () => {
    for (const { text, paragraphs } of ICON_SET_NOTICES) {
      expect(paragraphs[0]).toBe('MIT License')
      expect(paragraphs).toHaveLength(5)
      for (const paragraph of paragraphs) expect(paragraph).not.toMatch(/\n/)
      expect(paragraphs.join(' ').split(' ')).toEqual(text.split(/\s+/).filter(Boolean))
    }
  })
})
