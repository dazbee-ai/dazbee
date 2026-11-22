import { describe, expect, it } from 'vitest'

import { readZip } from './read-zip.ts'
import { zipOf } from './test-zip.ts'

describe('readZip', () => {
  it('reads each file of the archive, stored or deflated, and skips its folders', () => {
    const zip = zipOf([
      { path: 'pack/', text: '', method: 0 },
      { path: 'pack/arrows/arrow-1.svg', text: '<svg/>', method: 8 },
      { path: 'pack/README.txt', text: 'Thanks', method: 0 },
      { path: 'pack/empty.txt', text: '', method: 8 },
    ])
    expect(readZip(zip).map(({ path, bytes }) => [path, new TextDecoder().decode(bytes)])).toEqual([
      ['pack/arrows/arrow-1.svg', '<svg/>'],
      ['pack/README.txt', 'Thanks'],
      ['pack/empty.txt', ''],
    ])
  })

  it('refuses what isn’t a zip archive', () => {
    expect(() => readZip(new TextEncoder().encode('not a zip at all, just words'))).toThrow('not a zip archive')
  })
})
