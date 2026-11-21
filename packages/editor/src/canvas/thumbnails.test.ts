import { resolveObjectURL } from 'node:buffer'

import { describe, expect, it } from 'vitest'

import { openSession } from '@dazbee/doc'
import { openTestStore } from '@dazbee/doc/test-store'
import { resourceCache } from '@dazbee/renderer'
import { loadCanvasKit } from '@dazbee/renderer/node'
import { parseDesign } from '@dazbee/schema'

import { NO_FONTS } from '../font-loads.ts'
import { editorResources } from '../resources.ts'
import { frameScenes } from './scenes.ts'
import { GHOST_SIDE, thumbnailCache } from './thumbnails.ts'

const ck = await loadCanvasKit()

/** A session on a square frame holding a red square near its right edge. */
function opened() {
  const parsed = parseDesign({
    meta: { designId: 'd', name: 'D' },
    pages: { p: { name: 'Page', order: 'a0' } },
    frames: { sq: { pageId: 'p', name: 'Square', width: 1080, height: 1080, x: 0, y: 0, order: 'a0' } },
    nodes: {
      red: {
        type: 'graphic',
        parentId: 'sq',
        link: 'red',
        index: 'a0',
        name: 'Red',
        props: {
          x: 700,
          y: 100,
          width: 200,
          height: 200,
          shape: { kind: 'rect' },
          fills: [{ type: 'solid', color: '#FF0000FF' }],
        },
      },
    },
  })
  if (!parsed.success) throw new Error(parsed.errors.join('\n'))
  const session = openSession(openTestStore(parsed.design))
  const done = new AbortController()
  const resources = editorResources({
    ck,
    cache: resourceCache(ck),
    first: { fonts: [], fallbackFamilies: [], images: {} },
    firstFonts: NO_FONTS,
    sources: {},
    connected: () => true,
    status: () => {},
    signal: done.signal,
  })
  const design = () => session.design()
  /** A thumbnail cache over scenes of its own, its caches as new. */
  const thumbnails = () => {
    const scenes = frameScenes({ ck, resources, drawn: design, changes: () => session.changes() })
    return thumbnailCache({ ck, scenes, resources, current: design, drawn: design })
  }
  return { session, thumbnails }
}

/** The PNG bytes a thumbnail's object URL holds, null for none. */
async function bytesOf(url: string | null) {
  return url === null ? null : new Uint8Array(await (resolveObjectURL(url) as Blob).arrayBuffer())
}

describe('thumbnailCache', () => {
  it("draws a layer's thumbnail again when its frame's size changes how the frame shows it", async () => {
    const { session, thumbnails } = opened()
    const kept = thumbnails()
    expect(await bytesOf(kept.layer('red'))).not.toBeNull()
    // The frame's edge now runs through the square, which the frame shows only in part.
    session.run('frame.update', { frameId: 'sq', width: 800 })
    expect(await bytesOf(kept.layer('red'))).toEqual(await bytesOf(thumbnails().layer('red')))
  })
})

describe('ghost', () => {
  it("gives an image's faint picture at most GHOST_SIDE long, the same URL for its asset as its copy grows", async () => {
    const { thumbnails } = opened()
    const kept = thumbnails()
    const image = (width: number, height: number) => {
      const surface = ck.MakeSurface(width, height)
      if (!surface) throw new Error('no surface')
      surface.getCanvas().clear(ck.Color(200, 40, 40, 1))
      const made = surface.makeImageSnapshot()
      surface.delete()
      return made
    }
    const url = kept.ghost('photo', image(3000, 2000))
    const png = ck.MakeImageFromEncoded((await bytesOf(url)) ?? new Uint8Array())
    expect([png?.width(), png?.height()]).toEqual([GHOST_SIDE, 683])
    expect(kept.ghost('photo', image(4096, 2731))).toBe(url)
    expect(kept.ghost('other', image(300, 200))).not.toBe(url)
    png?.delete()
  })
})
