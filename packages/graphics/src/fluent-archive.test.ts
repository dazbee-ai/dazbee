import { createHash } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { readStickerPictures } from './fluent-archive.ts'
import type { TarFile } from './read-tar.ts'

/** A file of a stand-in archive, and the picture the list gives for it. */
function file(path: string, text: string) {
  const bytes = Buffer.from(text)
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  return { bytes, picture: { path, sha256, byteSize: bytes.length, width: 1, height: 1 } }
}

/** A stand-in archive reader giving these files, then a file no one asks for. */
function archive(...files: { picture: { path: string }; bytes: Buffer }[]) {
  return async (onFile: TarFile) => {
    for (const { picture, bytes } of files) await onFile(picture.path, bytes)
    await onFile('README.md', Buffer.from('not a picture'))
  }
}

describe('readStickerPictures', () => {
  it('tells each wanted picture’s bytes, waiting for each, and skips the files not wanted', async () => {
    const rocket = file('assets/Rocket/3D/rocket_3d.png', 'rocket')
    const fire = file('assets/Fire/3D/fire_3d.png', 'fire')
    const told: string[] = []
    await readStickerPictures(
      [rocket.picture],
      async (picture, bytes) => {
        await Promise.resolve()
        told.push(`${picture.path} ${Buffer.from(bytes).toString()}`)
      },
      archive(fire, rocket),
    )
    expect(told).toEqual(['assets/Rocket/3D/rocket_3d.png rocket'])
  })

  it('refuses a picture whose bytes aren’t the ones the list pins, telling none after it', async () => {
    const rocket = file('assets/Rocket/3D/rocket_3d.png', 'rocket')
    const changed = { ...rocket, bytes: Buffer.from('another rocket') }
    const told: string[] = []
    await expect(
      readStickerPictures([rocket.picture], async ({ path }) => void told.push(path), archive(changed)),
    ).rejects.toThrow(/has SHA-256 .*, not the pinned/)
    expect(told).toEqual([])
  })

  it('refuses when the archive lacks a wanted picture', async () => {
    const rocket = file('assets/Rocket/3D/rocket_3d.png', 'rocket')
    await expect(readStickerPictures([rocket.picture], async () => {}, archive())).rejects.toThrow(
      'the archive lacks assets/Rocket/3D/rocket_3d.png',
    )
  })
})
