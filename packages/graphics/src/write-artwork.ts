// Writes the artwork sets' manifest (`src/artwork.json`) and notices (`src/artwork-notices.json`) from the sets' pinned
// sources: a repository set's files from its GitHub archive at the commit `artwork-sets.ts` pins (each repository read
// once), a link set's files listed from its repository at a commit and fetched one at a time, and a zip set's files from
// its pack. An SVG file the SVG reader can't read whole, or larger than an SVG upload may be, and a picture an upload
// couldn't take, are left out. The manifest lists each graphic's tags and each of its styles' source, SHA-256, size and
// drawn size, and for an effect drawn light whether it is placed in the screen blend; the files themselves are stored by
// `pnpm --filter @dazbee/api artwork:upload`. Run `pnpm --filter @dazbee/graphics artwork [folder]` after changing a
// pin, and the upload after it. A folder given keeps what links served and is read again on the next run.
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { CanvasKit } from '@dazbee/canvaskit'
import { loadCanvasKit } from '@dazbee/renderer/node'
import { MAX_SVG_BYTES, MAX_UPLOAD_BYTES, readImageHeader } from '@dazbee/schema'
import { svgToLayers } from '@dazbee/svg'

import type { ArtworkEntry, ArtworkFile } from './artwork.ts'
import { ARTWORK_SET_IDS, ARTWORK_SETS, type ArtworkSetId, THREE_D_ANGLES, THREE_D_COLOURS } from './artwork-sets.ts'
import { readRepositoryArtwork, readZipArtwork, type SourceFile } from './artwork-sources.ts'
import { wordsFor } from './artwork-words.ts'
import { fetchLink } from './illustration-sources.ts'
import { tiledPattern } from './pattern-tile.ts'
import { readGitHubArchive, type TarFile } from './read-tar.ts'
import { WORD_BREAK } from './search.ts'
import { linePerEntry, tagsOf } from './set-files.ts'

/** A graphic found in a set's source: its name, its words, and its file in each style. */
interface Found {
  name: string
  words: string[]
  files: { style: string; source: string; bytes: Uint8Array }[]
}

const PACKAGE = join(import.meta.dirname, '..')
/**
 * The Creative Commons legal codes the CC sets' notices quote in full, pinned by their SHA-256, each with words only
 * it has, by which a makers' licence file that is the legal code already is known.
 */
const LEGAL_CODES = {
  'CC-BY-4.0': {
    url: 'https://creativecommons.org/licenses/by/4.0/legalcode.txt',
    sha256: '9ba9550ad48438d0836ddab3da480b3b69ffa0aac7b7878b5a0039e7ab429411',
    mark: 'Section 1 -- Definitions.',
  },
  'CC0-1.0': {
    url: 'https://creativecommons.org/publicdomain/zero/1.0/legalcode.txt',
    sha256: 'a2010f343487d3f7618affe54f789f5487602331c0a8d03f49e9a7c547cf0499',
    mark: 'Statement of Purpose',
  },
} as const
/** The files beside a set's folder its notice quotes: its makers' licence or readme. */
const LICENCE_FILE = /^(LICEN[CS]E(\.md|\.txt)?|README\.md)$/i
/**
 * How light an effect's drawn pixels are on average, from 0 to 1, below which it is drawn dark (black smoke, a scorch,
 * dirt) and keeps the normal blend; every other effect is light on dark, placed in the screen blend.
 */
const DARK = 0.25
/** The longest word a graphic's tags keep. */
const MAX_TAG_LENGTH = 30

const cache = process.argv[2]
if (cache) await mkdir(cache, { recursive: true })
const ck = await loadCanvasKit()
const archives = new Map<string, Map<string, Buffer>>()
const readers = { archive: cachedArchive, link: (url: string) => cached(url, fetchLink) }
const entries: [string, ArtworkEntry][] = []
const notices: Partial<Record<ArtworkSetId, string>> = {}
for (const set of ARTWORK_SET_IDS) {
  let left = 0
  const listed = await foundIn(set)
  const named = new Set<string>()
  for (const found of listed.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const files: Record<string, ArtworkFile> = {}
    for (const { style, source, bytes } of found.files) {
      const file = checked(set, source, bytes)
      if (file) files[style] = file
    }
    if (Object.keys(files).length < found.files.length) {
      left++
      continue
    }
    const name = unique(found.name, named)
    entries.push([`${set}/${name}`, { tags: tagsFor(set, found.words), files }])
  }
  notices[set] = await noticeOf(set)
  console.log(`${set}: ${named.size} graphics listed, ${left} left out`)
}
await writeFile(join(PACKAGE, 'src', 'artwork.json'), linePerEntry(entries))
await writeFile(join(PACKAGE, 'src', 'artwork-notices.json'), `${JSON.stringify(notices, null, 2)}\n`)

/** The graphics a set's source holds, each with its words and its file in each style. */
async function foundIn(set: ArtworkSetId): Promise<Found[]> {
  const { source, styles } = ARTWORK_SETS[set]
  const [style = ''] = styles
  if ('zip' in source)
    return (await readZipArtwork(set, readers))
      .filter(({ path }) => path.endsWith('.svg'))
      .map(({ path, bytes }) => single(path, bytes, style, folderWords(path, source.folder)))
  if ('repository' in source) {
    const found: Found[] = []
    await readRepositoryArtwork(
      set,
      async (file) => {
        if (file.pattern) found.push(fromPattern(file, style))
        else if (/\.(svg|png)$/.test(file.path))
          found.push(single(file.path, file.bytes, style, folderWords(file.path, source.folder)))
      },
      readers,
    )
    return found.map((each) => ({ ...each, words: [...each.words, ...keywordsOf(each.files[0]?.bytes)] }))
  }
  return set === '3dicons' ? threeDIcons(source.files) : await linkedPictures(set, source.files, style)
}

/**
 * A graphic of one file: its name from the file's, its words its name's and the folder words given, its source the
 * file's path or the link given.
 */
function single(path: string, bytes: Uint8Array, style: string, words: string[], source = path): Found {
  const name = slugOf(path.slice(path.lastIndexOf('/') + 1).replace(/\.\w+$/, ''))
  return { name, words: [...name.split('-'), ...words], files: [{ style, source, bytes }] }
}

/** A pattern's tile as a graphic: its slug as its name, its words its title's and its tags. */
function fromPattern({ path, bytes, pattern }: SourceFile, style: string): Found {
  const words = [...(pattern?.title.split(WORD_BREAK) ?? []), ...(pattern?.tags ?? [])]
  return { name: slugOf(pattern?.slug ?? path), words, files: [{ style, source: path, bytes }] }
}

/** The words of the folders between a set's folder and the file (`business`, `black smoke`). */
function folderWords(path: string, folder: string): string[] {
  return path
    .slice(folder.length + 1)
    .split('/')
    .slice(0, -1)
    .flatMap((part) => part.split(WORD_BREAK))
}

/** The keywords a Streamline file writes in its first group's id after `--` (`gift--present-box-birthday`). */
function keywordsOf(bytes: Uint8Array | undefined): string[] {
  if (!bytes) return []
  const id = /<g id="[^"]*?--([^"]+)"/.exec(new TextDecoder().decode(bytes.subarray(0, 4000)))?.[1]
  return id ? id.split('-') : []
}

/**
 * 3dicons' icons, as the meta files of its repository list them (title, file slug and category), each in its four
 * colour styles from its three angles, every picture fetched from its link under `files`.
 */
async function threeDIcons(files: string): Promise<Found[]> {
  const { source } = ARTWORK_SETS['3dicons']
  if (!('listed' in source) || !('repository' in source.listed)) throw new Error('3dicons is listed from a repository')
  const metas: string[] = []
  await cachedArchive(source.listed, (path, bytes) => {
    if (/^content\/3dicons-meta\/[^/]+\.md$/.test(path)) metas.push(bytes.toString('utf8'))
  })
  const found: Found[] = []
  for (const meta of metas) {
    const field = (key: string) => new RegExp(`^${key}:\\s*(.+)$`, 'm').exec(meta)?.[1]?.trim() ?? ''
    const slug = field('file-slug')
    if (!/^[a-z0-9-]+$/.test(slug)) continue
    const pictures = []
    for (const colour of THREE_D_COLOURS)
      for (const angle of THREE_D_ANGLES) {
        const link = `${files}${angle}/${colour}/${slug}-${angle}-${colour}.png`
        const bytes = await readers.link(link).catch((error: unknown) => leftOut(link, String(error)))
        if (bytes) pictures.push({ style: `${colour}-${angle}`, source: link, bytes })
      }
    if (pictures.length < THREE_D_COLOURS.length * THREE_D_ANGLES.length) continue
    const words = [...field('title').split(WORD_BREAK), ...field('category').split(WORD_BREAK)]
    found.push({ name: slug, words, files: pictures })
  }
  return found
}

/**
 * A link set's pictures, listed from its repository's tree at the commit (the PNG files under the folder its links
 * point into), each fetched from its link; a picture's words are its file's and its folder's.
 */
async function linkedPictures(set: ArtworkSetId, files: string, style: string): Promise<Found[]> {
  const { source } = ARTWORK_SETS[set]
  if (!('listed' in source) || !('repository' in source.listed)) throw new Error(`${set} is listed from a repository`)
  const { repository, commit } = source.listed
  const folder = decodeURIComponent(files.slice(files.indexOf(commit) + commit.length + 1))
  const tree = (await (
    await fetch(`https://api.github.com/repos/${repository}/git/trees/${commit}?recursive=1`, {
      headers: { 'user-agent': 'artwork-set-fetch/1.0 (node)' },
    })
  ).json()) as { tree: { path: string; type: string }[] }
  const found: Found[] = []
  for (const { path } of tree.tree.filter((each) => each.type === 'blob' && each.path.startsWith(folder))) {
    if (!path.endsWith('.png')) continue
    const link = files + path.slice(folder.length).split('/').map(encodeURIComponent).join('/')
    const words = folderWords(path, folder.replace(/\/$/, ''))
    const camel = path.slice(path.lastIndexOf('/') + 1).replace(/([a-z])([A-Z0-9])/g, '$1-$2')
    found.push(single(camel, await readers.link(link), style, words, link))
  }
  return found
}

/**
 * The file as the manifest lists it; undefined, told why, when an upload couldn't take it, or the SVG reader can't
 * read an SVG file whole but for a set's filters that only roughen its edges, which placing leaves out.
 */
function checked(set: ArtworkSetId, source: string, bytes: Uint8Array): ArtworkFile | undefined {
  const { format, kind } = ARTWORK_SETS[set]
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  if (format === 'png') {
    const header = readImageHeader(bytes)
    if (header?.contentType !== 'image/png' || bytes.length > MAX_UPLOAD_BYTES)
      return leftOut(source, 'it is not a PNG picture an upload may be')
    const size = { width: header.width, height: header.height }
    const light = kind === 'effect' && lightness(ck, bytes) >= DARK
    return { source, sha256, byteSize: bytes.length, ...size, ...(light ? { blend: 'screen' as const } : {}) }
  }
  if (bytes.length > MAX_SVG_BYTES) return leftOut(source, 'it is larger than an SVG upload may be')
  let text = new TextDecoder().decode(bytes)
  if (kind === 'background') text = tiledPattern(ck, text, { width: 1080, height: 1080 })
  let read
  try {
    read = svgToLayers(ck, text, { name: 'artwork' })
  } catch (error) {
    return leftOut(source, error instanceof Error ? error.message : String(error))
  }
  const lost = read.skipped.filter((part) => !(part === 'filter' && ARTWORK_SETS[set].roughEdges))
  if (lost.length > 0) return leftOut(source, `the reader leaves out its ${lost.join(', ')}`)
  const size = { width: Math.round(read.width * 100) / 100, height: Math.round(read.height * 100) / 100 }
  if (kind === 'background') {
    const [, width, height] = /width='([\d.]+)' height='([\d.]+)'/.exec(new TextDecoder().decode(bytes)) ?? []
    return { source, sha256, byteSize: bytes.length, width: Number(width), height: Number(height) }
  }
  return { source, sha256, byteSize: bytes.length, ...size }
}

/** How light a picture's drawn pixels are on average, each weighed by how opaque it is, from 0 to 1. */
function lightness(canvasKit: CanvasKit, bytes: Uint8Array): number {
  const image = canvasKit.MakeImageFromEncoded(bytes)
  if (!image) return 0
  const pixels = image.readPixels(0, 0, {
    width: image.width(),
    height: image.height(),
    colorType: canvasKit.ColorType.RGBA_8888,
    alphaType: canvasKit.AlphaType.Unpremul,
    colorSpace: canvasKit.ColorSpace.SRGB,
  }) as Uint8Array | null
  image.delete()
  if (!pixels) return 0
  let light = 0
  let weight = 0
  for (let at = 0; at < pixels.length; at += 4) {
    const alpha = (pixels[at + 3] ?? 0) / 255
    const luma = 0.2126 * (pixels[at] ?? 0) + 0.7152 * (pixels[at + 1] ?? 0) + 0.0722 * (pixels[at + 2] ?? 0)
    light += (luma / 255) * alpha
    weight += alpha
  }
  return weight === 0 ? 0 : light / weight
}

/** Tells why a file is left out of the manifest. */
function leftOut(source: string, why: string): undefined {
  console.log(`left out ${source}: ${why}`)
  return undefined
}

/** A graphic's tags: its own plain words, the words they add, and its set's tags. */
function tagsFor(set: ArtworkSetId, words: string[]): string[] {
  const own = words
    .flatMap((word) => word.toLowerCase().split(WORD_BREAK))
    .filter((word) => word && word.length <= MAX_TAG_LENGTH && !/^\d+$/.test(word))
  return tagsOf([...own, ...wordsFor(own), ...ARTWORK_SETS[set].tags])
}

/**
 * A set's notice: who made it, where Dazbee takes it from and under which licence, where its makers give its licence
 * when its source ships no file of it, then its makers' licence or readme as its source ships it, and the Creative
 * Commons legal code in full for a CC set whose licence file isn't that already.
 */
async function noticeOf(set: ArtworkSetId): Promise<string> {
  const { title, creator, source, licence, homepage, statement } = ARTWORK_SETS[set]
  const from =
    'zip' in source
      ? `the pack ${source.zip} as read on ${source.read}`
      : 'repository' in source
        ? `the GitHub repository ${source.repository} at commit ${source.commit.slice(0, 7)}`
        : 'repository' in source.listed
          ? `${source.files}, as the GitHub repository ${source.listed.repository} at commit ${source.listed.commit.slice(0, 7)} lists them`
          : `${source.files}, as read on ${source.listed.read}`
  const makers = await makersFiles(set)
  const parts = [
    `${title} (${homepage}), by ${creator.name} (${creator.url}). Used under ${licence.name} (${licence.url}). Dazbee takes the files from ${from}.`,
    ...(statement ? [statement] : []),
    ...makers,
  ]
  const code = licence.spdx === 'MIT' ? undefined : LEGAL_CODES[licence.spdx]
  if (code && !makers.some((text) => text.includes(code.mark))) parts.push(await pinnedText(code))
  return parts.join('\n\n')
}

/**
 * The licence or readme files a set's source ships beside its files, as they are: a zip set's readme, a repository
 * set's licence, and a link set's when its listing read its repository's archive.
 */
async function makersFiles(set: ArtworkSetId): Promise<string[]> {
  const { source } = ARTWORK_SETS[set]
  if ('zip' in source)
    return (await readZipArtwork(set, readers))
      .filter(({ path }) => /readme\.txt$/i.test(path))
      .map(({ bytes }) => new TextDecoder().decode(bytes).trim())
  const listed = 'listed' in source && 'repository' in source.listed ? source.listed : undefined
  const read = listed && archives.has(`${listed.repository}@${listed.commit}`)
  const repository = 'repository' in source ? source : read ? listed : undefined
  if (!repository) return []
  const texts: string[] = []
  const folder = 'folder' in repository ? repository.folder : ''
  await cachedArchive(repository, (path, bytes) => {
    const name = path.slice(path.lastIndexOf('/') + 1)
    const near = !path.includes('/') || path.startsWith(`${folder}/`)
    if (near && LICENCE_FILE.test(name) && !/^readme/i.test(name)) texts.push(bytes.toString('utf8').trim())
  })
  return texts
}

/** A text at a link, which must have the pinned SHA-256. */
async function pinnedText({ url, sha256 }: { url: string; sha256: string }): Promise<string> {
  const bytes = await readers.link(url)
  const got = createHash('sha256').update(bytes).digest('hex')
  if (got !== sha256) throw new Error(`${url} has SHA-256 ${got}, not the pinned ${sha256}`)
  return new TextDecoder().decode(bytes).trim()
}

/** A repository's archive at a commit, downloaded once and told again from memory. */
async function cachedArchive(source: { repository: string; commit: string }, onFile: TarFile): Promise<void> {
  const key = `${source.repository}@${source.commit}`
  let files = archives.get(key)
  if (!files) {
    const kept = new Map<string, Buffer>()
    await readGitHubArchive(source, (path, bytes) => {
      kept.set(path, bytes)
    })
    files = kept
    archives.set(key, files)
  }
  for (const [path, bytes] of files) await onFile(path, bytes)
}

/** The bytes at a link: from the folder given, when it kept them, else fetched and kept there. */
async function cached(url: string, get: (url: string) => Promise<Uint8Array>): Promise<Uint8Array> {
  if (!cache) return get(url)
  const file = join(cache, createHash('sha256').update(url).digest('hex'))
  try {
    return new Uint8Array(await readFile(file))
  } catch {
    const bytes = await get(url)
    await writeFile(file, bytes)
    return bytes
  }
}

/** A name as a graphic's: `Gift Box 2` as `gift-box-2`. */
function slugOf(name: string): string {
  return name
    .normalize('NFKD')
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-|-$/g, '')
}

/** The name, or with the first number after it that no graphic of the set has yet, kept as taken. */
function unique(name: string, taken: Set<string>): string {
  let made = name
  for (let n = 2; taken.has(made); n++) made = `${name}-${n}`
  taken.add(made)
  return made
}
