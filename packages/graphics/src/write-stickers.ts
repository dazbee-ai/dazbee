// Writes the bundled sticker sets from their pinned sources: Fluent Emoji from its GitHub repository's archive at the
// commit `sets.ts` pins (each emoji's default 3D picture as `sets/fluent-emoji/3d/<name>.png` and its flat drawings
// in `flat.json`), and each CC0 set from the files on its makers' site that `sticker-sources.json` lists, each checked
// against its SHA-256 (`sets/<set>/drawing.json`); each set's LICENSE beside it, the search index
// (`sets/stickers.json`) and the notices the app lists (`src/sticker-notices.json`). Run
// `pnpm --filter @dazbee/graphics stickers` after changing a pin.
import { createHash } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { createGunzip } from 'node:zlib'

import type { SetNotice } from './notices.ts'
import type { IndexedGraphic } from './search.ts'
import { linePerEntry, tagsOf } from './set-files.ts'
import { STICKER_SETS, stickerPin, type StickerSetId } from './sets.ts'
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
  picture?: Uint8Array
  drawing?: string
}

/** What the `tar` reader is told of each file: its path and its bytes. */
type TarFile = (path: string, bytes: Buffer) => void

const PACKAGE = join(import.meta.dirname, '..')
/** A tar block's size, which every header and every file's padded data is a whole number of. */
const BLOCK = 512
/** Where a Fluent Emoji file sits in the archive: its emoji's folder, the skin tone's folder if any, the style and the file. */
const FLUENT_FILE = /^[^/]+\/assets\/([^/]+)\/(?:Default\/)?(3D|Flat)\/[^/]+\.(png|svg)$/
const FLUENT_METADATA = /^[^/]+\/assets\/([^/]+)\/metadata\.json$/
const FLUENT_LICENCE = /^[^/]+\/LICENSE$/

const index: Partial<Record<StickerSetId, IndexedGraphic[]>> = {}
const notices: Partial<Record<StickerSetId, Pick<SetNotice, 'version' | 'licence' | 'text'>>> = {}

await fluent()
const cc0 = new TextDecoder().decode(await pinned(sources.cc0))
for (const set of ['open-peeps', 'humaaans', 'open-doodles'] as const) await fromSite(set, sources.files[set], cc0)
await writeFile(join(PACKAGE, 'sets', 'stickers.json'), JSON.stringify(index))
await writeFile(join(PACKAGE, 'src', 'sticker-notices.json'), `${JSON.stringify(notices, null, 2)}\n`)

/** Fluent Emoji: the archive of its repository at the pinned commit, read as it downloads. */
async function fluent() {
  const set = STICKER_SETS['fluent-emoji']
  if (!('commit' in set.source)) throw new Error('Fluent Emoji is pinned to a commit')
  const { repository, commit } = set.source
  const response = await fetch(`https://codeload.github.com/${repository}/tar.gz/${commit}`)
  if (!response.ok || !response.body) throw new Error(`GitHub answered ${response.status} for ${repository}`)
  const emoji = new Map<string, Emoji>()
  const entry = (folder: string) => {
    const known = emoji.get(folder) ?? {}
    emoji.set(folder, known)
    return known
  }
  let licence = ''
  const archived = await readTar(Readable.fromWeb(response.body).pipe(createGunzip()), (path, bytes) => {
    const [, folder = '', style] = FLUENT_FILE.exec(path) ?? []
    const [, described] = FLUENT_METADATA.exec(path) ?? []
    if (style === '3D') entry(folder).picture = bytes
    else if (style === 'Flat') entry(folder).drawing = bytes.toString('utf8')
    else if (described) entry(described).metadata = JSON.parse(bytes.toString('utf8')) as NonNullable<Emoji['metadata']>
    else if (FLUENT_LICENCE.test(path)) licence = bytes.toString('utf8')
  })
  if (archived !== commit) throw new Error(`the archive is of ${archived}, not the pinned ${commit}`)
  const out = await emptied('fluent-emoji')
  await mkdir(join(out, '3d'))
  const drawings: [string, string][] = []
  const indexed: IndexedGraphic[] = []
  for (const [folder, { metadata, picture, drawing }] of [...emoji].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const name = slugOf(folder)
    if (indexed.some(([each]) => each === name)) throw new Error(`two emoji are named ${name}`)
    if (picture) await writeFile(join(out, '3d', `${name}.png`), picture)
    if (drawing) drawings.push([name, drawing])
    const styles = [...(picture ? ['3d'] : []), ...(drawing ? ['flat'] : [])]
    if (styles.length === 0) continue
    const { cldr = '', keywords = [], group = '' } = metadata ?? {}
    indexed.push([name, styles, tagsOf([cldr, ...keywords, group, ...set.tags])])
  }
  await writeFile(join(out, 'flat.json'), linePerEntry(drawings))
  await writeLicence('fluent-emoji', licence)
  index['fluent-emoji'] = indexed
  console.log(`fluent-emoji ${stickerPin(set)}: ${indexed.length} emoji`)
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

/**
 * Reads a tar stream, telling `onFile` each regular file's path and bytes, and answers the commit the archive's
 * global header names, as GitHub writes it. Long paths come in a pax header or a ustar prefix.
 */
async function readTar(stream: AsyncIterable<Buffer>, onFile: TarFile): Promise<string> {
  let pending = Buffer.alloc(0)
  let commit = ''
  let nextPath: string | undefined
  for await (const chunk of stream) {
    pending = Buffer.concat([pending, chunk])
    while (pending.length >= BLOCK) {
      const header = pending.subarray(0, BLOCK)
      if (header.every((byte) => byte === 0)) {
        pending = pending.subarray(BLOCK)
        continue
      }
      const size = parseInt(field(header, 124, 12) || '0', 8)
      const length = BLOCK + Math.ceil(size / BLOCK) * BLOCK
      if (pending.length < length) break
      const data = pending.subarray(BLOCK, BLOCK + size)
      const type = String.fromCharCode(header[156] ?? 0)
      const prefix = field(header, 345, 155)
      const path = nextPath ?? (prefix ? `${prefix}/${field(header, 0, 100)}` : field(header, 0, 100))
      if (type === 'g') commit = paxOf(data).comment ?? commit
      else if (type === 'x') nextPath = paxOf(data).path
      else {
        if (type === '0' || type === '\0') onFile(path, Buffer.from(data))
        nextPath = undefined
      }
      pending = pending.subarray(length)
    }
  }
  return commit
}

/** A NUL-ended text field of a tar header. */
function field(header: Buffer, at: number, length: number): string {
  const bytes = header.subarray(at, at + length)
  const end = bytes.indexOf(0)
  return bytes
    .subarray(0, end === -1 ? length : end)
    .toString('utf8')
    .trim()
}

/** A pax header's records, `<length> <key>=<value>\n` each. */
function paxOf(data: Buffer): Record<string, string> {
  const records: Record<string, string> = {}
  let at = 0
  while (at < data.length) {
    const space = data.indexOf(0x20, at)
    const length = Number(data.subarray(at, space).toString('utf8'))
    if (!length) break
    const record = data.subarray(space + 1, at + length - 1).toString('utf8')
    const equals = record.indexOf('=')
    records[record.slice(0, equals)] = record.slice(equals + 1)
    at += length
  }
  return records
}
