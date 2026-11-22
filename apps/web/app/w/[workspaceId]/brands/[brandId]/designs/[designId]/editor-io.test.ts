// The editor's loads through the app: a Google face's file from its permanent address, kept by the browser and
// Cloudflare, and a brand's upload through the brand's own route.
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { FontFamily } from '@dazbee/schema'

import { fontLoader } from './editor-io.ts'

const CATALOG: FontFamily[] = [
  {
    family: 'Lora',
    source: 'google',
    category: 'serif',
    faces: [{ id: 'lora00000400', family: 'Lora', weight: 400, style: 'normal', source: 'google', byteSize: 3 }],
  },
  {
    family: 'House Sans',
    source: 'upload',
    category: null,
    faces: [{ id: 'house0000400', family: 'House Sans', weight: 400, style: 'normal', source: 'upload', byteSize: 3 }],
  },
]

/** Answers the catalog at the brand's fonts route and three bytes anywhere else, noting each address asked. */
function fakeFetch() {
  const asked: string[] = []
  vi.stubGlobal('fetch', (url: string) => {
    asked.push(url)
    return Promise.resolve(
      url.endsWith('/fonts') ? Response.json(CATALOG) : new Response(new Uint8Array([1, 2, 3]), { status: 200 }),
    )
  })
  return asked
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fontLoader', () => {
  it('loads a Google face’s file from its permanent address, with no call through the brand', async () => {
    const asked = fakeFetch()
    const { fontFaces, fontFile } = fontLoader('w1', 'b1')
    const [face] = await fontFaces(['Lora'])
    if (!face) throw new Error('Lora is not in the catalog')
    expect(await fontFile(face)).toEqual(new Uint8Array([1, 2, 3]))
    expect(asked).toEqual(['/w/w1/brands/b1/fonts', '/fonts/google/lora00000400.ttf'])
  })

  it('loads a brand’s upload through the brand’s route', async () => {
    const asked = fakeFetch()
    const { fontFaces, fontFile } = fontLoader('w1', 'b1')
    const [face] = await fontFaces(['House Sans'])
    if (!face) throw new Error('House Sans is not in the catalog')
    await fontFile(face)
    expect(asked).toEqual(['/w/w1/brands/b1/fonts', '/w/w1/brands/b1/fonts/house0000400'])
  })
})
