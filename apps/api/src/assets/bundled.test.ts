// Bundled files, against Postgres and storage from Docker Compose (`docker compose up -d --wait`).
import { describe, expect, it } from 'vitest'

import { bundledKey, originalKey } from '../storage-keys.ts'
import { brand, db, run, sibling, storage, workspace } from '../test-api.ts'
import { png, sha256 } from '../test-files.ts'
import { addBundledAsset, NotBundled, type ReadBundled, storeBundled } from './bundled.ts'

/** A bundled file of this run, as a manifest lists it, with its bytes. */
function file(mark: string) {
  const bytes = png(5, 4, `bundled-${run}-${mark}`)
  return { sha256: sha256(bytes), bytes }
}

/** A reader of the given files' source that counts how often it is asked, and gives each wanted file's bytes. */
function source(files: { sha256: string; bytes: Uint8Array }[]) {
  const asked: number[] = []
  const read: ReadBundled<{ sha256: string }> = async (wanted, onFile) => {
    asked.push(wanted.length)
    for (const { sha256: wantedSha } of wanted) {
      const found = files.find((each) => each.sha256 === wantedSha)
      if (found) await onFile(found, found.bytes)
    }
  }
  return { read, asked }
}

describe('storeBundled', () => {
  it('stores each file storage doesn’t hold, and reads nothing when it holds them all', async () => {
    const files = [file('a'), file('b')]
    const { read, asked } = source(files)
    expect(await storeBundled(storage, files, read)).toEqual({ stored: 2, already: 0 })
    expect(await storage.get(bundledKey(files[0]?.sha256 ?? ''))).toEqual(files[0]?.bytes)
    expect(await storeBundled(storage, files, read)).toEqual({ stored: 0, already: 2 })
    expect(asked).toEqual([2])
    const more = [...files, file('c')]
    expect(await storeBundled(storage, more, source(more).read)).toEqual({ stored: 1, already: 2 })
  })
})

// Recording an image makes its thumbnail with CanvasKit, which takes seconds to load on a busy CI runner.
describe('addBundledAsset', { timeout: 30_000 }, () => {
  it('copies a bundled file into the brand’s library once, named, with its tags joining', async () => {
    const { sha256: sha, bytes } = file('sticker')
    await storage.put(bundledKey(sha), bytes, 'image/png')
    const input = { sha256: sha, name: 'Rocket · Fluent Emoji', tags: ['sticker', 'emoji'] }
    const asset = await addBundledAsset(db, storage, workspace.id, brand.id, input)
    expect(asset).toMatchObject({ brandId: brand.id, sha256: sha, name: input.name, tags: ['sticker', 'emoji'] })
    expect(asset).toMatchObject({ contentType: 'image/png', width: 5, height: 4, byteSize: bytes.length })
    expect(await storage.get(originalKey(workspace.id, sha))).toEqual(bytes)
    const again = await addBundledAsset(db, storage, workspace.id, brand.id, { ...input, tags: ['fluent'] })
    expect(again).toMatchObject({ id: asset.id, name: input.name, tags: ['sticker', 'emoji', 'fluent'] })
    const other = await addBundledAsset(db, storage, workspace.id, sibling.id, input)
    expect(other.id).not.toBe(asset.id)
  })

  it('refuses a SHA-256 storage keeps no bundled file of', async () => {
    const { sha256: sha } = file('missing')
    await expect(
      addBundledAsset(db, storage, workspace.id, brand.id, { sha256: sha, name: 'Missing' }),
    ).rejects.toThrow(NotBundled)
  })
})
