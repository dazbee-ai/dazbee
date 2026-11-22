import { createHash } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { readArtworkFiles, readRepositoryArtwork, readZipArtwork } from './artwork-sources.ts'
import { patternTile } from './pattern-tile.ts'
import type { TarFile } from './read-tar.ts'
import { zipOf } from './test-zip.ts'

/** A Coolshapes file as its repository holds it. */
const SHAPE = '<svg><path fill="white"/></svg>'
/** Pattern Monster's index file, listing one pattern. */
const PATTERN = {
  title: 'Waves - 1',
  slug: 'waves-1',
  mode: 'stroke' as const,
  width: 20,
  height: 10,
  tags: ['waves'],
  path: "<path d='M0 5h20'/>",
}
const INDEX = `const index = ${JSON.stringify([PATTERN])}; export default index;`

/** A stand-in archive: these files, then one outside every set's folder. */
function archive(files: Record<string, string>) {
  return async (_source: unknown, onFile: TarFile) => {
    for (const [path, text] of Object.entries(files)) await onFile(path, Buffer.from(text))
    await onFile('README.md', Buffer.from('not art'))
  }
}

const sha256 = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const noLinks = () => Promise.reject(new Error('no link is fetched'))

describe('readRepositoryArtwork', () => {
  it('reads the files in a repository set’s folder', async () => {
    const told: string[] = []
    const files = { 'public/shapes/svg/star_1.svg': SHAPE, 'public/other.svg': SHAPE }
    await readRepositoryArtwork(
      'coolshapes',
      async ({ path }) => {
        told.push(path)
      },
      { archive: archive(files), link: noLinks },
    )
    expect(told).toEqual(['public/shapes/svg/star_1.svg'])
  })

  it('reads each pattern of a pattern set’s index file as its tile', async () => {
    const told: [string, string][] = []
    await readRepositoryArtwork(
      'pattern-monster',
      async ({ path, bytes }) => {
        told.push([path, new TextDecoder().decode(bytes)])
      },
      { archive: archive({ 'src/routes/_index.js': INDEX }), link: noLinks },
    )
    expect(told).toEqual([['src/routes/_index.js#waves-1', patternTile(PATTERN)]])
  })
})

describe('readZipArtwork', () => {
  it('refuses a pack whose SHA-256 isn’t the pinned one', async () => {
    const pack = zipOf([{ path: 'dddoodle-pack/arrows/arrow-1.svg', text: '<svg/>', method: 8 }])
    await expect(readZipArtwork('dddoodle', { archive: archive({}), link: async () => pack })).rejects.toThrow(
      /not the pinned 4c1c07c/,
    )
  })
})

describe('readArtworkFiles', () => {
  it('tells each wanted file once its SHA-256 is the pinned one, from the archive and from links', async () => {
    const link = 'https://pub-821312cfd07a4061bf7b99c1f23ed29b.r2.dev/v1/dynamic/color/rocket-dynamic-color.png'
    const tile = patternTile(PATTERN)
    const wanted = [
      { set: 'coolshapes' as const, source: 'public/shapes/svg/star_1.svg', sha256: sha256(SHAPE) },
      { set: 'pattern-monster' as const, source: 'src/routes/_index.js#waves-1', sha256: sha256(tile) },
      { set: '3dicons' as const, source: link, sha256: sha256('png') },
    ]
    const told: string[] = []
    const files = { 'public/shapes/svg/star_1.svg': SHAPE, 'src/routes/_index.js': INDEX }
    await readArtworkFiles(
      wanted,
      async ({ source }) => {
        told.push(source)
      },
      {
        archive: archive(files),
        link: async (url) => (url === link ? new TextEncoder().encode('png') : Promise.reject(new Error(url))),
      },
    )
    expect(told).toEqual(['public/shapes/svg/star_1.svg', 'src/routes/_index.js#waves-1', link])
  })

  it('refuses a file whose bytes aren’t the pinned ones, and a source that lacks one', async () => {
    const readers = { archive: archive({ 'public/shapes/svg/star_1.svg': SHAPE }), link: noLinks }
    const changed = [{ set: 'coolshapes' as const, source: 'public/shapes/svg/star_1.svg', sha256: sha256('other') }]
    await expect(readArtworkFiles(changed, async () => {}, readers)).rejects.toThrow(/not the pinned/)
    const gone = [{ set: 'coolshapes' as const, source: 'public/shapes/svg/gone.svg', sha256: sha256(SHAPE) }]
    await expect(readArtworkFiles(gone, async () => {}, readers)).rejects.toThrow(/lack public\/shapes\/svg\/gone/)
  })

  it('refuses a link set’s file at a link outside its files, fetching nothing', async () => {
    const fetched: string[] = []
    const link = async (url: string) => {
      fetched.push(url)
      return new Uint8Array()
    }
    const files =
      'https://raw.githubusercontent.com/Poipoise/Deadly-Faith/ea19f5b3ce8c4c01027b2fb9389f82cf293779c1/kenney_smoke-particles/PNG/'
    const elsewhere = [
      { set: 'kenney-smoke' as const, source: 'https://elsewhere.example/a.png', sha256: '0' },
      { set: 'kenney-smoke' as const, source: `${files}../../../other/a.png`, sha256: '0' },
    ]
    for (const file of elsewhere)
      await expect(readArtworkFiles([file], async () => {}, { archive: archive({}), link })).rejects.toThrow(
        /not a link to kenney-smoke/,
      )
    expect(fetched).toEqual([])
  })
})
