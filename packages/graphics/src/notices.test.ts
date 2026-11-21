import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { ICON_SET_NOTICES } from './notices.ts'
import type { IconIndex } from './search.ts'
import { ICON_SET_IDS, ICON_SETS } from './sets.ts'

const PACKAGE = join(import.meta.dirname, '..')
const read = (...path: string[]) => readFileSync(join(PACKAGE, ...path), 'utf8')

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
})

describe('the bundled drawings', () => {
  it('draw every icon the index lists in each of its styles, and no other', () => {
    const index = JSON.parse(read('sets', 'index.json')) as IconIndex
    for (const id of ICON_SET_IDS)
      for (const style of ICON_SETS[id].styles) {
        const drawn = Object.keys(JSON.parse(read('sets', id, `${style}.json`)) as object).sort()
        const listed = index[id].flatMap(([name, styles]) => (styles.includes(style) ? [name] : [])).sort()
        expect(drawn.length).toBeGreaterThan(0)
        expect(drawn).toEqual(listed)
      }
  })
})
