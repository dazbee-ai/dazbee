import { createHash } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { readIllustrationFiles, readRepositorySet } from './illustration-sources.ts'
import type { TarFile } from './read-tar.ts'

/** An unDraw file as its repository's copy paints the accent, and as the readers give it. */
const SCENE = '<svg fill="var(--primary-svg-color)"/>'
const WRITTEN = '<svg fill="#6c63ff"/>'

/** A stand-in archive of unDraw's repository: these files, then one outside its folder. */
function archive(files: Record<string, string>) {
  return async (_source: unknown, onFile: TarFile) => {
    for (const [path, text] of Object.entries(files)) await onFile(path, Buffer.from(text))
    await onFile('README.md', Buffer.from('not a scene'))
  }
}

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex')
const noLinks = () => Promise.reject(new Error('no link is fetched'))

describe('readRepositorySet', () => {
  it('reads a repository set’s SVG files in its folder, the accent written for its CSS variable', async () => {
    const told: [string, string][] = []
    await readRepositorySet(
      'undraw',
      async (path, bytes) => {
        told.push([path, new TextDecoder().decode(bytes)])
      },
      { archive: archive({ 'svgs/delivery.svg': SCENE, 'svgs/notes.txt': 'no' }), link: noLinks },
    )
    expect(told).toEqual([['svgs/delivery.svg', WRITTEN]])
  })

  it('refuses a gallery set', async () => {
    await expect(readRepositorySet('manypixels-birdview', async () => {})).rejects.toThrow(/not taken from/)
  })
})

describe('readIllustrationFiles', () => {
  it('tells each wanted file once its SHA-256 is the pinned one, from the archive and from links', async () => {
    const link = 'https://gallery.example/team.svg'
    const wanted = [
      { set: 'undraw' as const, source: 'svgs/delivery.svg', sha256: sha256(WRITTEN) },
      { set: 'manypixels-chromablue' as const, source: link, sha256: sha256('<svg/>') },
    ]
    const told: string[] = []
    await readIllustrationFiles(
      wanted,
      async ({ source }) => {
        told.push(source)
      },
      {
        archive: archive({ 'svgs/delivery.svg': SCENE, 'svgs/other.svg': SCENE }),
        link: async (url) => (url === link ? new TextEncoder().encode('<svg/>') : Promise.reject(new Error(url))),
      },
    )
    expect(told).toEqual(['svgs/delivery.svg', link])
  })

  it('refuses a file whose bytes aren’t the pinned ones, and a source that lacks one', async () => {
    const readers = { archive: archive({ 'svgs/delivery.svg': SCENE }), link: noLinks }
    const changed = [{ set: 'undraw' as const, source: 'svgs/delivery.svg', sha256: sha256(SCENE) }]
    await expect(readIllustrationFiles(changed, async () => {}, readers)).rejects.toThrow(/not the pinned/)
    const gone = [{ set: 'undraw' as const, source: 'svgs/gone.svg', sha256: sha256(WRITTEN) }]
    await expect(readIllustrationFiles(gone, async () => {}, readers)).rejects.toThrow(/lack svgs\/gone\.svg/)
  })
})
