import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { beforeAll, describe, expect, it } from 'vitest'

import type { CanvasKit } from '@dazbee/canvaskit'
import { loadCanvasKit } from '@dazbee/renderer/node'
import { imageFits, MAX_UPLOAD_BYTES } from '@dazbee/schema'
import { svgToLayers } from '@dazbee/svg'

import { stickerPictures } from './pictures.ts'
import type { StickerIndex } from './search.ts'
import { STICKER_SET_IDS, STICKER_SETS } from './sets.ts'
import { stickerFile } from './sticker-file.ts'

/** The bundled sets' folder. */
const SETS = join(import.meta.dirname, '..', 'sets')
/** The stickers' search index. */
const index = JSON.parse(readFileSync(join(SETS, 'stickers.json'), 'utf8')) as StickerIndex

let ck: CanvasKit

beforeAll(async () => {
  ck = await loadCanvasKit()
})

describe('stickerFile', () => {
  it('gives what a picture style’s PNG is: Fluent Emoji’s 3D, its path in the source, SHA-256 and size', () => {
    expect(stickerFile('fluent-emoji', 'rocket', '3d')).toEqual({
      format: 'picture',
      path: 'assets/Rocket/3D/rocket_3d.png',
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      byteSize: expect.any(Number),
      width: 256,
      height: 256,
    })
  })

  it('gives a drawing style’s SVG file, which the SVG reader makes layers of', () => {
    const file = stickerFile('open-peeps', 'peep-standing-1', 'drawing')
    expect(file.format).toBe('drawing')
    if (file.format !== 'drawing') return
    const { tree, skipped } = svgToLayers(ck, file.svg, { name: 'Peep' })
    expect(Object.values(tree.nodes).filter(({ type }) => type === 'graphic').length).toBeGreaterThan(0)
    expect(skipped).toEqual([])
  })

  it('has a file for every sticker the index lists in each of its styles, and no other', () => {
    for (const set of STICKER_SET_IDS)
      for (const { name: style, format } of STICKER_SETS[set].styles) {
        const listed = index[set].flatMap(([name, styles]) => (styles.includes(style) ? [name] : [])).sort()
        const files =
          format === 'picture'
            ? stickerPictures().flatMap((picture) =>
                picture.sticker.startsWith(`${set}/`) && picture.style === style
                  ? [picture.sticker.split('/')[1] ?? '']
                  : [],
              )
            : Object.keys(JSON.parse(readFileSync(join(SETS, set, `${style}.json`), 'utf8')) as object)
        expect(listed.length).toBeGreaterThan(0)
        expect(files.sort()).toEqual(listed)
      }
  })

  it('gives every picture as a PNG within the upload limits, and every drawing as layers the reader makes', () => {
    for (const set of STICKER_SET_IDS)
      for (const [name, styles] of index[set])
        for (const style of styles) {
          const file = stickerFile(set, name, style)
          if (file.format === 'picture') {
            const fits = imageFits(file) && file.byteSize <= MAX_UPLOAD_BYTES && file.path.endsWith('.png')
            expect([name, fits]).toEqual([name, true])
            continue
          }
          const { tree } = svgToLayers(ck, file.svg, { name })
          expect([name, Object.keys(tree.nodes).length > 1]).toEqual([name, true])
        }
  }, 120_000)

  it('refuses a style the set doesn’t have, and a sticker it doesn’t draw', () => {
    expect(() => stickerFile('open-peeps', 'peep-2', '3d')).toThrow()
    expect(() => stickerFile('open-doodles', 'no-such-doodle', 'drawing')).toThrow()
  })
})
