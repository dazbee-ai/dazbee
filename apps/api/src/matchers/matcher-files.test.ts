// Storing the matchers' files, against storage from Docker Compose (`docker compose up -d --wait`).
import { describe, expect, it } from 'vitest'

import type { ReleaseFile } from '@dazbee/matchers/release-files'

import { matcherFileKey } from '../storage-keys.ts'
import { run, storage } from '../test-api.ts'
import { sha256 } from '../test-files.ts'
import { storeMatcherFiles } from './matcher-files.ts'

/** A stand-in file of a release, of this run, with its bytes. */
function file(mark: string): ReleaseFile & { bytes: Uint8Array } {
  const bytes = new TextEncoder().encode(`matcher file ${mark} ${run}`)
  return { name: `text-${mark}.bin`, sha256: sha256(bytes), size: bytes.length, bytes }
}

describe('storeMatcherFiles', () => {
  it('stores each file storage doesn’t hold, checked, and downloads none it holds', async () => {
    const files = [file('a'), file('b')]
    const asked: string[] = []
    const download = async ({ name }: ReleaseFile) => {
      asked.push(name)
      return files.find((each) => each.name === name)?.bytes ?? new Uint8Array()
    }
    expect(await storeMatcherFiles(storage, files, download)).toEqual({ stored: 2, already: 0 })
    expect(await storage.get(matcherFileKey(files[0]?.sha256 ?? ''))).toEqual(files[0]?.bytes)
    expect(await storeMatcherFiles(storage, files, download)).toEqual({ stored: 0, already: 2 })
    expect(asked).toEqual(['text-a.bin', 'text-b.bin'])
  })

  it('stores nothing for bytes that are not the file', async () => {
    const wanted = file('c')
    await expect(storeMatcherFiles(storage, [wanted], async () => file('d').bytes)).rejects.toThrow(
      /^text-c\.bin as downloaded from the release matchers-\w+ is not the file release\.json lists$/,
    )
    expect(await storage.exists(matcherFileKey(wanted.sha256))).toBe(false)
  })
})
