// The editor's loads through the app: a Google face's file from its permanent address, kept by the browser and
// Cloudflare, and a brand's upload through the brand's own route.
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { FontFamily } from '@dazbee/schema'

import * as fontCatalog from '@/components/brand-kit/font-catalog.ts'

import { fontLoader, startStageEditor } from './editor-io.ts'

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

/**
 * Answers the families asked for at the brand's fonts route, from `catalog`, no brand kit, and three bytes anywhere
 * else, noting each address asked.
 */
function fakeFetch(catalog = CATALOG) {
  const asked: string[] = []
  vi.stubGlobal('fetch', (url: string) => {
    asked.push(url)
    const { pathname, searchParams } = new URL(url, 'https://app.example')
    if (pathname.endsWith('/kit/data')) return Promise.resolve(new Response('No kit', { status: 404 }))
    if (!pathname.endsWith('/fonts')) return Promise.resolve(new Response(new Uint8Array([1, 2, 3]), { status: 200 }))
    const families = searchParams.getAll('family')
    return Promise.resolve(Response.json(catalog.filter((f) => families.includes(f.family))))
  })
  return asked
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('fontLoader', () => {
  it('loads a Google face’s file from its permanent address, with no call through the brand', async () => {
    const asked = fakeFetch()
    const { fontFaces, fontFile } = fontLoader('w1', 'b1')
    const [face] = await fontFaces(['Lora'])
    if (!face) throw new Error('Lora is not in the catalog')
    expect(await fontFile(face)).toEqual(new Uint8Array([1, 2, 3]))
    expect(asked).toEqual(['/w/w1/brands/b1/fonts?family=Lora', '/fonts/google/faces/lora00000400.ttf'])
  })

  it('loads a brand’s upload through the brand’s route', async () => {
    const asked = fakeFetch()
    const { fontFaces, fontFile } = fontLoader('w1', 'b1')
    const [face] = await fontFaces(['House Sans'])
    if (!face) throw new Error('House Sans is not in the catalog')
    await fontFile(face)
    expect(asked).toEqual(['/w/w1/brands/b1/fonts?family=House+Sans', '/w/w1/brands/b1/fonts/house0000400'])
  })

  it('asks the brand for only the families a design uses, and again for a family it uploads later', async () => {
    const asked = fakeFetch()
    const { fontFaces } = fontLoader('w1', 'b1')
    expect((await fontFaces(['Lora', 'Gone Sans'])).map((face) => face.id)).toEqual(['lora00000400'])
    const uploaded: FontFamily = {
      family: 'New Upload',
      source: 'upload',
      category: null,
      faces: [
        { id: 'newup0000400', family: 'New Upload', weight: 400, style: 'normal', source: 'upload', byteSize: 3 },
      ],
    }
    fakeFetch([...CATALOG, uploaded])
    expect((await fontFaces(['New Upload'])).map((face) => face.id)).toEqual(['newup0000400'])
    expect(asked).toEqual(['/w/w1/brands/b1/fonts?family=Lora&family=Gone+Sans'])
  })

  it('asks for a design of many families in a few asks, each under the most the API takes', async () => {
    const asked = fakeFetch()
    const { fontFaces } = fontLoader('w1', 'b1')
    const families = [...Array.from({ length: 119 }, (_, i) => `Family ${i}`), 'Lora']
    expect((await fontFaces(families)).map((face) => face.id)).toEqual(['lora00000400'])
    expect(asked.map((url) => new URL(url, 'https://app.example').searchParams.getAll('family').length)).toEqual([
      100, 20,
    ])
  })

  it('answers from the catalog the page read last when the brand can’t be asked, as offline', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')))
    const { fontFaces } = fontLoader('w1', 'b1')
    await expect(fontFaces(['Lora'])).rejects.toThrow('Failed to fetch')
    vi.spyOn(fontCatalog, 'loadedCatalog').mockReturnValue(CATALOG)
    expect((await fontFaces(['Lora', 'Gone Sans'])).map((face) => face.id)).toEqual(['lora00000400'])
  })
})

describe('startStageEditor', () => {
  it('starts one editor for a stage mounted twice as strict mode mounts it, asking for each address once', async () => {
    const asked = fakeFetch()
    /** A stage's mount: an editor that loads the design's fonts, as `startEditor` does on opening. */
    const mount = (signal: AbortSignal) =>
      startStageEditor('w1', 'b1', signal, async () => {
        const { fontFaces, fontFile } = fontLoader('w1', 'b1')
        const faces = await fontFaces(['Lora', 'House Sans'])
        await Promise.all(faces.map(fontFile))
        return faces.map((face) => face.id)
      })
    const first = new AbortController()
    const firstMount = mount(first.signal)
    first.abort()
    const secondMount = mount(new AbortController().signal)
    expect(await firstMount).toBeNull()
    expect(await secondMount).toEqual(['lora00000400', 'house0000400'])
    expect(asked).toEqual([
      '/w/w1/brands/b1/kit/data',
      '/w/w1/brands/b1/fonts?family=Lora&family=House+Sans',
      '/fonts/google/faces/lora00000400.ttf',
      '/w/w1/brands/b1/fonts/house0000400',
    ])
  })

  it('asks for the brand kit again for a stage mounted after the first ask settled', async () => {
    const asked = fakeFetch()
    const signal = new AbortController().signal
    await startStageEditor('w1', 'b1', signal, () => Promise.resolve(null))
    await startStageEditor('w1', 'b1', signal, () => Promise.resolve(null))
    expect(asked).toEqual(['/w/w1/brands/b1/kit/data', '/w/w1/brands/b1/kit/data'])
  })
})
