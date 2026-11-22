import { afterEach, describe, expect, it, vi } from 'vitest'

import type { FontFamily } from '@dazbee/schema'

import { categoryOf, faceFor, loadCatalog, scriptsOf, weightsOf } from './font-catalog.ts'

const family = (name: string, source: FontFamily['source']): FontFamily => ({
  family: name,
  source,
  category: null,
  faces: [{ id: `${name}-400`, family: name, weight: 400, style: 'normal', source, byteSize: 1 }],
})

describe('categoryOf', () => {
  it('reads Google’s category, and gives each font we ship its own', () => {
    expect(categoryOf({ ...family('Lora', 'google'), category: 'serif' })).toBe('serif')
    expect(categoryOf(family('Noto Sans', 'builtin'))).toBe('sans-serif')
    expect(categoryOf(family('Noto Sans Devanagari', 'builtin'))).toBe('sans-serif')
    expect(categoryOf(family('Noto Naskh Arabic', 'builtin'))).toBe('serif')
  })

  it('has none for an upload, or for a category it doesn’t know', () => {
    expect(categoryOf(family('Brand Grotesk', 'upload'))).toBeNull()
    expect(categoryOf({ ...family('Odd', 'google'), category: 'symbols' })).toBeNull()
  })
})

describe('scriptsOf', () => {
  it('reads Google’s scripts, and gives each font we ship the scripts it draws', () => {
    expect(scriptsOf({ ...family('Cairo', 'google'), scripts: ['Arab', 'Latn'] })).toEqual(['Arab', 'Latn'])
    expect(scriptsOf(family('Noto Sans', 'builtin'))).toEqual(['Latn', 'Cyrl', 'Grek'])
    expect(scriptsOf(family('Noto Sans Devanagari', 'builtin'))).toEqual(['Deva'])
    expect(scriptsOf(family('Noto Naskh Arabic', 'builtin'))).toEqual(['Arab'])
  })

  it('has none for an upload, or a Google family listed without them', () => {
    expect(scriptsOf(family('Brand Grotesk', 'upload'))).toEqual([])
    expect(scriptsOf(family('Gone Sans', 'google'))).toEqual([])
  })
})

describe('faceFor', () => {
  const faces = (name: string, list: [number, 'normal' | 'italic'][]): FontFamily => ({
    ...family(name, 'google'),
    faces: list.map(([weight, style]) => ({
      id: `${name}-${weight}-${style}`,
      family: name,
      weight,
      style,
      source: 'google',
      byteSize: 1,
    })),
  })

  it('gives the face of the style nearest the weight', () => {
    const lora = faces('Lora', [
      [400, 'normal'],
      [700, 'normal'],
      [400, 'italic'],
    ])
    expect(faceFor(lora, 700, 'normal')?.id).toBe('Lora-700-normal')
    expect(faceFor(lora, 600, 'normal')?.id).toBe('Lora-700-normal')
    expect(faceFor(lora, 700, 'italic')?.id).toBe('Lora-400-italic')
  })

  it('gives an upright face for an italic the family lacks, and none for a family it doesn’t know', () => {
    expect(faceFor(faces('Inter', [[400, 'normal']]), 700, 'italic')?.id).toBe('Inter-400-normal')
    expect(faceFor(undefined, 400, 'normal')).toBeUndefined()
  })
})

describe('weightsOf', () => {
  const face = (weight: number, style: 'normal' | 'italic', weights?: { min: number; max: number }) => ({
    id: `f-${weight}-${style}`,
    family: 'Vary Sans',
    weight,
    ...(weights ? { weights } : {}),
    style,
    source: 'upload' as const,
    byteSize: 1,
  })
  const of = (...faces: ReturnType<typeof face>[]): FontFamily => ({
    family: 'Vary Sans',
    source: 'upload',
    category: null,
    faces,
  })

  it('lists a variable face’s weights across its range, and each face of one weight', () => {
    expect(weightsOf(of(face(400, 'normal', { min: 100, max: 900 })))).toEqual([
      100, 200, 300, 400, 500, 600, 700, 800, 900,
    ])
    expect(weightsOf(of(face(400, 'normal'), face(700, 'normal')))).toEqual([400, 700])
  })

  it('takes the upright faces where there are some, a variable italic’s range where there are none', () => {
    expect(weightsOf(of(face(400, 'normal'), face(400, 'italic', { min: 300, max: 700 })))).toEqual([400])
    expect(weightsOf(of(face(400, 'italic', { min: 300, max: 700 })))).toEqual([300, 400, 500, 600, 700])
  })
})

describe('loadCatalog', () => {
  /** A family whose one face has an id as the API gives them. */
  const listed = (name: string, source: FontFamily['source'], id: string): FontFamily => ({
    ...family(name, source),
    faces: [{ id, family: name, weight: 400, style: 'normal', source, byteSize: 1 }],
  })
  const lora = { ...listed('Lora', 'google', 'lora00000400'), category: 'serif' }
  const raleway = listed('Raleway', 'google', 'rale00000400')
  const myLora = listed('Lora', 'upload', 'mylora000400')
  const house = listed('House Sans', 'upload', 'house0000400')

  /** Answers each address from `answers`, a Response or a thrown error, noting each address asked. */
  function fakeFetch(answers: Record<string, () => Response>) {
    const asked: string[] = []
    vi.stubGlobal('fetch', (url: string) => {
      asked.push(url)
      const answer = answers[url]
      return answer ? Promise.resolve(answer()) : Promise.reject(new TypeError('Failed to fetch'))
    })
    return asked
  }

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('joins the Google list the browser keeps and the brand’s uploads, asking for the list once', async () => {
    const list = '/fonts/google/lists/00000000000000000000000000000001.js'
    const asked = fakeFetch({
      '/w/w1/brands/b1/fonts/catalog': () => Response.json({ google: list, uploads: [myLora, house] }),
      [list]: () => Response.json([lora, raleway]),
    })
    const catalog = await loadCatalog('w1', 'b1')
    expect(catalog?.map((f) => [f.family, f.source])).toEqual([
      ['House Sans', 'upload'],
      ['Lora', 'upload'],
      ['Raleway', 'google'],
    ])
    await loadCatalog('w1', 'b1')
    expect(asked).toEqual(['/w/w1/brands/b1/fonts/catalog', list, '/w/w1/brands/b1/fonts/catalog'])
  })

  it('reads the whole catalog from the brand when the list doesn’t come, and asks for the list again next time', async () => {
    const list = '/fonts/google/lists/00000000000000000000000000000002.js'
    const asked = fakeFetch({
      '/w/w1/brands/b1/fonts/catalog': () => Response.json({ google: list, uploads: [house] }),
      [list]: () => Response.json({ error: 'No such list' }, { status: 404 }),
      '/w/w1/brands/b1/fonts': () => Response.json([house, lora]),
    })
    expect((await loadCatalog('w1', 'b1'))?.map((f) => f.family)).toEqual(['House Sans', 'Lora'])
    await loadCatalog('w1', 'b1')
    expect(asked.filter((url) => url === list)).toHaveLength(2)
  })

  it('reads the whole catalog from the brand when the list comes empty or cut off', async () => {
    const list = '/fonts/google/lists/00000000000000000000000000000003.js'
    for (const body of ['', '[{"family":"Lo']) {
      fakeFetch({
        '/w/w1/brands/b1/fonts/catalog': () => Response.json({ google: list, uploads: [house] }),
        [list]: () => new Response(body, { headers: { 'content-type': 'application/json' } }),
        '/w/w1/brands/b1/fonts': () => Response.json([house, lora]),
      })
      expect((await loadCatalog('w1', 'b1'))?.map((f) => f.family)).toEqual(['House Sans', 'Lora'])
    }
  })

  it('reads the whole catalog from a server that doesn’t answer the catalog in two parts', async () => {
    fakeFetch({
      '/w/w1/brands/b1/fonts/catalog': () => new Response('No such font', { status: 404 }),
      '/w/w1/brands/b1/fonts': () => Response.json([house, lora]),
    })
    expect((await loadCatalog('w1', 'b1'))?.map((f) => f.family)).toEqual(['House Sans', 'Lora'])
  })

  it('gives nothing offline, so the chooser keeps what it had', async () => {
    fakeFetch({})
    expect(await loadCatalog('w1', 'b1')).toBeNull()
  })
})
