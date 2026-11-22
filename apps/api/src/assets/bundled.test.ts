// Bundled files, against Postgres and storage from Docker Compose (`docker compose up -d --wait`).
import { describe, expect, it } from 'vitest'

import { bundledKey, originalKey } from '../storage-keys.ts'
import { brand, db, run, sibling, storage, workspace } from '../test-api.ts'
import { png, sha256 } from '../test-files.ts'
import { findAsset, InvalidUpload } from './assets.ts'
import { addBundledAsset, NotBundled, type ReadBundled, storeBundled } from './bundled.ts'

/** A bundled file of this run, as a manifest lists it, with its bytes. */
function file(mark: string) {
  const bytes = png(5, 4, `bundled-${run}-${mark}`)
  return { sha256: sha256(bytes), bytes }
}

/** The most layers the SVG reader makes of a file before refusing it (MAX_LAYERS in @dazbee/svg's limits). */
const SVG_READER_LAYERS = 5_000

/** A bundled SVG file of this run drawing `rects` rectangles, as a manifest lists it, with its bytes. */
function svgFile(mark: string, rects = 1) {
  const shapes = Array.from({ length: rects }, (_, i) => `<rect x="${i % 100}" width="1" height="1" fill="#6c63ff"/>`)
  const text = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><desc>${run}-${mark}</desc>${shapes.join('')}</svg>`
  const bytes = new TextEncoder().encode(text)
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

  it('adds a bundled SVG file as an SVG asset, read by the SVG reader as an upload is', async () => {
    const { sha256: sha, bytes } = svgFile('scene')
    await storage.put(bundledKey(sha), bytes, 'image/svg+xml')
    const input = { sha256: sha, name: 'Delivery · unDraw', tags: ['illustration', 'undraw'] }
    const asset = await addBundledAsset(db, storage, workspace.id, brand.id, input)
    expect(asset).toMatchObject({ sha256: sha, contentType: 'image/svg+xml', width: 400, height: 300 })
    expect(asset).toMatchObject({ name: input.name, tags: input.tags, byteSize: bytes.length })
  })

  it('refuses a bundled SVG file past the SVG reader’s limits, recording nothing and keeping no copy', async () => {
    const { sha256: sha, bytes } = svgFile('hostile', SVG_READER_LAYERS + 1)
    await storage.put(bundledKey(sha), bytes, 'image/svg+xml')
    await expect(
      addBundledAsset(db, storage, workspace.id, brand.id, { sha256: sha, name: 'Hostile' }),
    ).rejects.toThrow(InvalidUpload)
    expect(await findAsset(db, workspace.id, brand.id, { sha256: sha })).toBeNull()
    expect(await storage.exists(originalKey(workspace.id, sha))).toBe(false)
  })

  it('refuses a SHA-256 storage keeps no bundled file of, even one the workspace holds as an upload', async () => {
    const { sha256: uploaded, bytes } = file('uploaded')
    await storage.put(originalKey(workspace.id, uploaded), bytes, 'image/png')
    await expect(
      addBundledAsset(db, storage, workspace.id, brand.id, { sha256: uploaded, name: 'Up' }),
    ).rejects.toThrow(NotBundled)
  })

  it('refuses a SHA-256 storage keeps no bundled file of', async () => {
    const { sha256: sha } = file('missing')
    await expect(
      addBundledAsset(db, storage, workspace.id, brand.id, { sha256: sha, name: 'Missing' }),
    ).rejects.toThrow(NotBundled)
  })
})

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
