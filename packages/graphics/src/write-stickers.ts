// Writes the bundled sticker sets from their pinned sources: Fluent Emoji from its GitHub repository's archive at the
// commit `sets.ts` pins (its flat drawings in `sets/fluent-emoji/flat.json`, and what each default 3D picture is in
// `src/sticker-pictures.json`, the pictures themselves being stored by `pnpm --filter @dazbee/api stickers:upload`),
// and each CC0 set from the files on its makers' site that `sticker-sources.json` lists, each checked against its
// SHA-256 (`sets/<set>/drawing.json`); each set's LICENSE beside it, the search index (`sets/stickers.json`) and the
// notices the app lists (`src/sticker-notices.json`). Run `pnpm --filter @dazbee/graphics stickers` after changing a
// pin, and the upload after it.
import { createHash } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { readImageHeader } from '@dazbee/schema'

import { readFluentArchive } from './fluent-archive.ts'
import type { SetNotice } from './notices.ts'
import type { StickerPicture } from './pictures.ts'
import type { IndexedGraphic } from './search.ts'
import { linePerEntry, tagsOf } from './set-files.ts'
import { STICKER_SET_IDS, STICKER_SETS, stickerPin, type StickerSetId } from './sets.ts'
import sources from './sticker-sources.json' with { type: 'json' }

/** One file of a CC0 set, as `sticker-sources.json` pins it. */
interface SourceFile {
  name: string
  url: string
  sha256: string
  tags?: string[]
}

/** Fluent Emoji's emoji, by its folder's name: its metadata, its default 3D picture and its default flat drawing. */
interface Emoji {
  metadata?: { cldr?: string; keywords?: string[]; group?: string }
  picture?: Omit<StickerPicture, 'id'>
  drawing?: string
}

const PACKAGE = join(import.meta.dirname, '..')
/** Where a Fluent Emoji file sits in its repository: its emoji's folder, the skin tone's folder if any, the style and the file. */
const FLUENT_FILE = /^assets\/([^/]+)\/(?:Default\/)?(3D|Flat)\/[^/]+\.(png|svg)$/
const FLUENT_METADATA = /^assets\/([^/]+)\/metadata\.json$/

const index: Partial<Record<StickerSetId, IndexedGraphic[]>> = {}
const notices: Partial<Record<StickerSetId, Pick<SetNotice, 'version' | 'licence' | 'text'>>> = {}

await fluent()
const cc0 = new TextDecoder().decode(await pinned(sources.cc0))
for (const set of STICKER_SET_IDS) {
  if (!('read' in STICKER_SETS[set].source)) continue
  const files: SourceFile[] | undefined = (sources.files as Partial<Record<StickerSetId, SourceFile[]>>)[set]
  if (!files) throw new Error(`sticker-sources.json lists no files of ${set}`)
  await fromSite(set, files, cc0)
}
await writeFile(join(PACKAGE, 'sets', 'stickers.json'), JSON.stringify(index))
await writeFile(join(PACKAGE, 'src', 'sticker-notices.json'), `${JSON.stringify(notices, null, 2)}\n`)

/**
 * Fluent Emoji, from the archive of its repository at the pinned commit: its flat drawings, and for each 3D picture
 * its path, SHA-256, size and pixel size, since the repository doesn't hold the pictures themselves.
 */
async function fluent() {
  const set = STICKER_SETS['fluent-emoji']
  const emoji = new Map<string, Emoji>()
  const entry = (folder: string) => {
    const known = emoji.get(folder) ?? {}
    emoji.set(folder, known)
    return known
  }
  let licence = ''
  await readFluentArchive((path, bytes) => {
    const [, folder = '', style] = FLUENT_FILE.exec(path) ?? []
    const [, described] = FLUENT_METADATA.exec(path) ?? []
    if (style === '3D') entry(folder).picture = pictureOf(path, bytes)
    else if (style === 'Flat') entry(folder).drawing = bytes.toString('utf8')
    else if (described) entry(described).metadata = JSON.parse(bytes.toString('utf8')) as NonNullable<Emoji['metadata']>
    else if (path === 'LICENSE') licence = bytes.toString('utf8')
  })
  const out = await emptied('fluent-emoji')
  const drawings: [string, string][] = []
  const pictures: [string, Omit<StickerPicture, 'id'>][] = []
  const indexed: IndexedGraphic[] = []
  for (const [folder, { metadata, picture, drawing }] of [...emoji].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const name = slugOf(folder)
    if (indexed.some(([each]) => each === name)) throw new Error(`two emoji are named ${name}`)
    if (picture) pictures.push([`fluent-emoji/${name}/3d`, picture])
    if (drawing) drawings.push([name, drawing])
    const styles = [...(picture ? ['3d'] : []), ...(drawing ? ['flat'] : [])]
    if (styles.length === 0) continue
    const { cldr = '', keywords = [], group = '' } = metadata ?? {}
    indexed.push([name, styles, tagsOf([cldr, ...keywords, group, ...set.tags])])
  }
  await writeFile(join(out, 'flat.json'), linePerEntry(drawings))
  await writeFile(join(PACKAGE, 'src', 'sticker-pictures.json'), linePerEntry(pictures))
  await writeLicence('fluent-emoji', licence)
  index['fluent-emoji'] = indexed
  console.log(`fluent-emoji ${stickerPin(set)}: ${indexed.length} emoji, ${pictures.length} pictures listed`)
}

/** A 3D picture as the manifest lists it; throws when it isn't a PNG. */
function pictureOf(path: string, bytes: Buffer): Omit<StickerPicture, 'id'> {
  const header = readImageHeader(bytes)
  if (header?.contentType !== 'image/png') throw new Error(`${path} is not a PNG`)
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  return { path, sha256, byteSize: bytes.length, width: header.width, height: header.height }
}

/** A CC0 set: each file its site offers, checked against its pin, and the CC0 legal code below the set's dedication. */
async function fromSite(set: StickerSetId, files: SourceFile[], legalCode: string) {
  const { dedication = '', tags } = STICKER_SETS[set]
  const out = await emptied(set)
  const drawings: [string, string][] = []
  for (const file of files) {
    const text = new TextDecoder().decode(await pinned(file))
    if (!/<svg[\s>]/.test(text)) throw new Error(`${file.url} is not an SVG file`)
    drawings.push([file.name, text])
  }
  await writeFile(join(out, 'drawing.json'), linePerEntry(drawings))
  await writeLicence(set, `${dedication}\n\n${legalCode}`)
  index[set] = files.map(({ name, tags: own = [] }) => [name, ['drawing'], tagsOf([...own, ...tags])])
  console.log(`${set} ${stickerPin(STICKER_SETS[set])}: ${files.length} drawings`)
}

/** The set's folder under `sets/`, emptied, so a file the source no longer has goes. */
async function emptied(set: StickerSetId): Promise<string> {
  const out = join(PACKAGE, 'sets', set)
  await rm(out, { recursive: true, force: true })
  await mkdir(out, { recursive: true })
  return out
}

/** The set's LICENSE and its notice; its lines end in LF, as the app shows them, whichever ends the source has. */
async function writeLicence(set: StickerSetId, text: string) {
  const lf = text.replaceAll(/\r\n/g, '\n')
  await writeFile(join(PACKAGE, 'sets', set, 'LICENSE'), lf)
  notices[set] = { version: stickerPin(STICKER_SETS[set]), licence: STICKER_SETS[set].licence, text: lf }
}

/** The bytes at a pinned link; throws when they aren't the bytes pinned. */
async function pinned({ url, sha256 }: { url: string; sha256: string }): Promise<Uint8Array> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${url} answered ${response.status}`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  const got = createHash('sha256').update(bytes).digest('hex')
  if (got !== sha256) throw new Error(`${url} has changed since it was pinned: its SHA-256 is ${got}, not ${sha256}`)
  return bytes
}

/** A folder's name as a sticker's: `Thumbs up` as `thumbs-up`, `Flag: Japan` as `flag-japan`. */
function slugOf(folder: string): string {
  return folder
    .normalize('NFKD')
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-|-$/g, '')
}
