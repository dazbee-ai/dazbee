// The Google Fonts import, against Postgres and storage from Docker Compose (`docker compose up -d --wait`).
import { eq, inArray } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'

import { fontFaces } from '@dazbee/db'
import { emojiTestFont, variableTestFont } from '@dazbee/fonts/test-fonts'

import { googleFontKey, googleSourceKey, previewKey } from '../storage-keys.ts'
import { db, run, storage } from '../test-api.ts'
import { fakeGoogleFonts, fontFile, googleFamily, sha256 } from '../test-files.ts'
import { withoutSvgTable } from './font-file.ts'
import { copiedSources, importGoogleFamily } from './google.ts'

// Copying a font draws its preview with CanvasKit, which takes seconds on a busy two-core CI runner.
describe('importGoogleFamily', { timeout: 30_000 }, () => {
  const regular = fontFile('NotoSans-Regular.ttf')
  const bold = fontFile('NotoSans-Bold.ttf')
  const families: string[] = []
  /** A Google family named for this run and the test, removed after the run. */
  const family = (name: string, files: Parameters<typeof googleFamily>[1]) => {
    families.push(`${name} ${run}`)
    return googleFamily(`${name} ${run}`, files)
  }
  const faces = (name: string) =>
    db
      .select()
      .from(fontFaces)
      .where(eq(fontFaces.family, `${name} ${run}`))

  afterAll(async () => {
    await db.delete(fontFaces).where(inArray(fontFaces.family, families))
  })

  it('copies each file with a preview and records its face, then leaves the family as it is without fetching', async () => {
    const google = family('Copied Sans', [
      { file: 'CopiedSans-Regular.ttf', bytes: regular, weight: 400 },
      { file: 'CopiedSans-Bold.ttf', bytes: bold, weight: 700 },
    ])
    const fake = fakeGoogleFonts(google)
    expect(await importGoogleFamily(db, storage, google, { copied: new Map(), get: fake.get })).toEqual({
      copied: 2,
      bytes: regular.length + bold.length,
      upToDate: 0,
      failed: null,
    })
    expect((await faces('Copied Sans')).map((f) => [f.weight, f.style, f.sha256, f.category])).toEqual(
      expect.arrayContaining([
        [400, 'normal', sha256(regular), 'sans-serif'],
        [700, 'normal', sha256(bold), 'sans-serif'],
      ]),
    )
    expect(await storage.get(googleFontKey(sha256(bold)))).toEqual(bold)
    expect(await storage.exists(previewKey(googleFontKey(sha256(bold))))).toBe(true)

    // A new run reads what was copied from storage, as the import does when it starts.
    fake.asked.length = 0
    const again = await importGoogleFamily(db, storage, google, { copied: await copiedSources(storage), get: fake.get })
    expect(again).toEqual({ copied: 0, bytes: 0, upToDate: 2, failed: null })
    expect(fake.asked).toEqual([])
  })

  it('stops a family at a file it can’t fetch, keeping those before, and the next run copies only the rest', async () => {
    const google = family('Halted Sans', [
      { file: 'HaltedSans-Regular.ttf', bytes: regular, weight: 400 },
      { file: 'HaltedSans-Bold.ttf', bytes: bold, weight: 700 },
    ])
    const fake = fakeGoogleFonts(google)
    const boldUrl = [...google.served.keys()][1] ?? ''
    const failing = (async (input: string | URL | Request) =>
      String(input) === boldUrl ? new Response('busy', { status: 503 }) : fake.get(input)) as typeof fetch
    const waits: number[] = []
    const wait = async (ms: number) => void waits.push(ms)
    const first = await importGoogleFamily(db, storage, google, { copied: new Map(), get: failing, wait })
    expect(first).toMatchObject({ copied: 1, upToDate: 0, failed: 'HaltedSans-Bold.ttf: google/fonts answered 503' })
    // A busy answer is tried twice more, after a longer wait each time.
    expect(waits).toEqual([15_000, 30_000])
    expect((await faces('Halted Sans')).map((f) => f.weight)).toEqual([400])

    fake.asked.length = 0
    const second = await importGoogleFamily(db, storage, google, {
      copied: await copiedSources(storage),
      get: fake.get,
    })
    expect(second).toEqual({ copied: 1, bytes: bold.length, upToDate: 1, failed: null })
    expect(fake.asked).toEqual([boldUrl])
    expect((await faces('Halted Sans')).map((f) => f.weight).sort()).toEqual([400, 700])
  })

  it('copies a file again when its face is no longer recorded, though it was copied before', async () => {
    const google = family('Forgotten Sans', [{ file: 'ForgottenSans-Regular.ttf', bytes: regular, weight: 400 }])
    const fake = fakeGoogleFonts(google)
    await importGoogleFamily(db, storage, google, { copied: new Map(), get: fake.get })
    await db.delete(fontFaces).where(eq(fontFaces.family, google.family))
    const again = await importGoogleFamily(db, storage, google, { copied: await copiedSources(storage), get: fake.get })
    expect(again).toMatchObject({ copied: 1, upToDate: 0 })
    expect(await faces('Forgotten Sans')).toHaveLength(1)
  })

  it('tries a file again when the connection drops while its bytes come', async () => {
    const google = family('Dropped Sans', [{ file: 'DroppedSans-Regular.ttf', bytes: regular, weight: 400 }])
    const fake = fakeGoogleFonts(google)
    let drops = 1
    const dropping = (async (input: string | URL | Request) => {
      if (drops-- > 0) return new Response(new ReadableStream({ pull: (c) => c.error(new Error('reset')) }))
      return fake.get(input)
    }) as typeof fetch
    const done = await importGoogleFamily(db, storage, google, {
      copied: new Map(),
      get: dropping,
      wait: async () => {},
    })
    expect(done).toMatchObject({ copied: 1, failed: null })
  })

  it('deletes the file a new commit’s file takes the place of, with its preview and note', async () => {
    // Bytes of this run alone: Noto Sans with this run's id after its tables, which a font reader ignores.
    const old = new Uint8Array([...regular, ...new TextEncoder().encode(`run ${run}`)])
    const before = family('Updated Sans', [{ file: 'UpdatedSans-Regular.ttf', bytes: old, weight: 400 }])
    const copied = new Map<string, string>()
    await importGoogleFamily(db, storage, before, { copied, get: fakeGoogleFonts(before).get })
    expect(await storage.exists(googleFontKey(sha256(old)))).toBe(true)
    // The next commit's Regular has other bytes.
    const after = googleFamily(before.family, [{ file: 'UpdatedSans-Regular.ttf', bytes: bold, weight: 400 }])
    expect(await importGoogleFamily(db, storage, after, { copied, get: fakeGoogleFonts(after).get })).toMatchObject({
      copied: 1,
    })
    expect((await faces('Updated Sans')).map((f) => f.sha256)).toEqual([sha256(bold)])
    expect(await storage.exists(googleFontKey(sha256(old)))).toBe(false)
    expect(await storage.exists(previewKey(googleFontKey(sha256(old))))).toBe(false)
    expect(await storage.exists(googleSourceKey(before.faces[0]?.blob ?? '', sha256(old)))).toBe(false)
    expect(copied.has(before.faces[0]?.blob ?? '')).toBe(false)
    expect(await storage.exists(googleFontKey(sha256(bold)))).toBe(true)
  })

  it('refuses bytes that are not google/fonts’ file, recording nothing', async () => {
    const google = family('Swapped Sans', [{ file: 'SwappedSans-Regular.ttf', bytes: regular, weight: 400 }])
    const swapped = (async () => new Response(bold.slice())) as typeof fetch
    const done = await importGoogleFamily(db, storage, google, { copied: new Map(), get: swapped })
    expect(done.failed).toMatch(/^SwappedSans-Regular\.ttf: its \d+ bytes are not google\/fonts' file$/)
    expect(await faces('Swapped Sans')).toEqual([])
  })

  it('records a variable file once in its style, with its weight range and its own default weight', async () => {
    const variable = variableTestFont()
    const google = family('Ranged Sans', [{ file: 'RangedSans[wght].ttf', bytes: variable, weight: 400 }])
    const done = await importGoogleFamily(db, storage, google, { copied: new Map(), get: fakeGoogleFonts(google).get })
    expect(done).toMatchObject({ copied: 1, failed: null })
    expect((await faces('Ranged Sans')).map((f) => [f.weight, f.weightMin, f.weightMax, f.style])).toEqual([
      [400, 100, 900, 'normal'],
    ])
  })

  it('copies a file without the SVG glyphs CanvasKit never draws, noting the bytes it stored', async () => {
    const emoji = emojiTestFont()
    const kept = withoutSvgTable(emoji)
    expect(kept.length).toBeLessThan(emoji.length)
    const google = family('Glyph Emoji', [{ file: 'GlyphEmoji-Regular.ttf', bytes: emoji, weight: 400 }])
    const done = await importGoogleFamily(db, storage, google, { copied: new Map(), get: fakeGoogleFonts(google).get })
    expect(done).toMatchObject({ copied: 1, bytes: kept.length })
    expect((await faces('Glyph Emoji'))[0]).toMatchObject({ sha256: sha256(kept), byteSize: kept.length })
    expect(await storage.get(googleFontKey(sha256(kept)))).toEqual(kept)
    expect(await storage.exists(googleSourceKey(google.faces[0]?.blob ?? '', sha256(kept)))).toBe(true)
  })
})
