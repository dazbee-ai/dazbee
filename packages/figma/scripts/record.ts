// Records one real Figma file for the pixel harness: its JSON with `geometry=paths`, the bytes of
// its image fills and Figma's own PNG of each top-level frame at scale 1. Run by hand, never in CI,
// as `pnpm --filter @dazbee/figma record '<link>'` with the token in FIGMA_TOKEN, set as
// tests/pixels/fixtures/figma/RECIPE.md's "Record it" says.
//
// The token goes only to https://api.figma.com, as `X-Figma-Token`, and is written nowhere: image
// and render downloads (download.ts) are never given it, the API's redirects are refused, and every
// error is redacted. A link with a `node-id` records only `/files?ids=` for that node, as
// `node-link.json`.
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { MAX_UPLOAD_BYTES } from '@dazbee/schema'

import { FRAME_TYPES } from '../src/layers.ts'
import { field, type FigmaNode, MAX_FIGMA_NODES, ownMap, readFigmaFile, record as asRecord } from '../src/read.ts'
import { download, isTimeout, readCapped } from './download.ts'

export interface RecordOptions {
  /** The Figma API's origin; the command line always passes https://api.figma.com. */
  apiBase: string
  token: string
  /** The file's key, or a branch's key. */
  key: string
  /** A node in the API's form (`1:2`): records only the file call for it. */
  nodeId?: string
  /** The recording's folder; a whole recording replaces it only once every file is written. */
  outDir: string
  /** Lets downloads use http, for a stub server in tests. */
  allowHttp?: boolean
}

/** What a run recorded: a whole file, or a node link and whether `/files?ids=` returned the node's page with it. */
export type RecordSummary =
  | {
      kind: 'file'
      images: number
      failedImages: number
      renders: number
      failedRenders: number
      imageHosts: string[]
    }
  | { kind: 'node'; pageReturned: boolean }

/** Figma's file JSON as a plain object the recording adds its own field to. */
type FileJson = Record<string, unknown>

interface Frame {
  id: string
  name: string
}

interface Saved {
  /** Each saved item's key and its file, relative to the recording's folder. */
  saved: Record<string, unknown>
  failed: Record<string, unknown>[]
}

const FIGMA_API = 'https://api.figma.com'
/** Where the recording lands: `tests/pixels/fixtures/figma/recorded` at the repo's root. */
const RECORDED_DIR = fileURLToPath(new URL('../../../tests/pixels/fixtures/figma/recorded', import.meta.url))
/** The most an API answer may hold, as decoded. */
const ANSWER_BYTES = 200 * 1024 * 1024
const RENDER_BYTES = 100 * 1024 * 1024
const API_MS = 120_000
const KEY = /^[A-Za-z0-9]{1,128}$/
/** A node id as Figma makes them: `1:2`, or an instance's child `I1:2;3:4`. */
const NODE_ID = /^I?\d+:\d+(;\d+:\d+)*$/
/** An `imageRef` as Figma makes them: a lowercase hex hash, so no two differ only in case. */
const IMAGE_REF = /^[0-9a-f]{16,128}$/
const UNSAFE_NAME_REASON = 'not a name the recording can save'
/** Figma's personal access tokens; any one in a message is redacted, not only the one in use. */
const ANY_FIGMA_TOKEN = /figd_[A-Za-z0-9_-]+/g

/** Records the file `options.key` names; throws with a message that never holds the token. */
export async function record(options: RecordOptions): Promise<RecordSummary> {
  if (!KEY.test(options.key) || (options.nodeId !== undefined && !NODE_ID.test(options.nodeId)))
    throw new Error('The file key or node id is not one Figma makes.')
  const api = apiClient(options)
  const fileQuery: Record<string, string> = { geometry: 'paths' }
  if (options.nodeId) fileQuery.ids = options.nodeId
  const file = await api.json(`/v1/files/${options.key}`, fileQuery, 'the file')
  const document = designDocument(file)
  const thumbnail = typeof file.thumbnailUrl === 'string' ? [file.thumbnailUrl] : []
  delete file.thumbnailUrl
  if (options.nodeId) return recordNodeLink(options, file, document, thumbnail)

  const imagesAnswer = await api.json(`/v1/files/${options.key}/images`, {}, 'the image list')
  const imageUrls = ownMap(field(field(imagesAnswer, 'meta'), 'images') ?? imagesAnswer.images)
  const frames = topFrames(document)
  const renderQuery = { ids: frames.map((f) => f.id).join(','), format: 'png', scale: '1', use_absolute_bounds: 'true' }
  const renderUrls =
    frames.length === 0
      ? new Map<string, unknown>()
      : ownMap((await api.json(`/v1/images/${options.key}`, renderQuery, 'the frame renders')).images)

  const staging = `${options.outDir}.partial`
  rmSync(staging, { recursive: true, force: true })
  mkdirSync(join(staging, 'images'), { recursive: true })
  mkdirSync(join(staging, 'figma'), { recursive: true })
  const images = await saveImages(imageUrls, staging, options.allowHttp)
  const renders = await saveRenders(frames, renderUrls, staging, options.allowHttp)
  const imageHosts = hostsOf(imageUrls.values())
  file.recording = {
    imageHosts,
    renderHosts: hostsOf(renderUrls.values()),
    images: images.saved,
    failedImages: images.failed,
    renders: renders.saved,
    failedRenders: renders.failed,
  }
  const secrets = [options.token, ...thumbnail, ...urlStrings(imageUrls.values()), ...urlStrings(renderUrls.values())]
  writeFileSync(join(staging, 'file.json'), cleanJson(file, secrets))

  // A node link recorded before stays beside the new recording.
  const nodeLink = join(options.outDir, 'node-link.json')
  if (existsSync(nodeLink)) renameSync(nodeLink, join(staging, 'node-link.json'))
  rmSync(options.outDir, { recursive: true, force: true })
  mkdirSync(dirname(options.outDir), { recursive: true })
  renameSync(staging, options.outDir)
  return {
    kind: 'file',
    images: Object.keys(images.saved).length,
    failedImages: images.failed.length,
    renders: Object.keys(renders.saved).length,
    failedRenders: renders.failed.length,
    imageHosts,
  }
}

/** The file key and node a Figma file link names, or why it names none. */
export function parseFigmaLink(link: string): { key: string; nodeId?: string } | { error: string } {
  let url: URL
  try {
    url = new URL(link)
  } catch {
    return { error: 'That is not a link.' }
  }
  if (url.protocol !== 'https:' || (url.hostname !== 'www.figma.com' && url.hostname !== 'figma.com'))
    return { error: 'The link must start with https://www.figma.com/.' }
  const parts = url.pathname.split('/').filter(Boolean)
  if (parts[0] !== 'design' && parts[0] !== 'file')
    return { error: 'The link must be to a Figma design file (figma.com/design/…).' }
  const key = parts[2] === 'branch' ? parts[3] : parts[1]
  if (!key || !KEY.test(key)) return { error: 'The link holds no file key.' }
  const node = url.searchParams.get('node-id')
  if (node === null) return { key }
  const nodeId = node.replaceAll('-', ':')
  return NODE_ID.test(nodeId) ? { key, nodeId } : { error: 'The link’s node-id is not one Figma makes.' }
}

/** `text` with every copy of `token`, and anything shaped like a Figma token, replaced by `[FIGMA_TOKEN]`. */
export function redact(text: string, token: string): string {
  return (token ? text.replaceAll(token, '[FIGMA_TOKEN]') : text).replace(ANY_FIGMA_TOKEN, '[FIGMA_TOKEN]')
}

/** The command line: records the link in `args[0]` with `FIGMA_TOKEN` from `env`; returns the exit code. */
export async function main(
  args: string[],
  env: Record<string, string | undefined>,
  log: (line: string) => void = console.log,
): Promise<number> {
  const token = env.FIGMA_TOKEN?.trim() ?? ''
  // Out of the environment, so nothing this process starts inherits it.
  delete env.FIGMA_TOKEN
  if (!token) {
    log('Set FIGMA_TOKEN in this shell to a Figma personal access token with File content: read, then run again.')
    return 1
  }
  if (!/^[\x21-\x7e]+$/.test(token)) {
    log('FIGMA_TOKEN holds characters a Figma token never has (spaces or line breaks); copy it again.')
    return 1
  }
  if (env.NODE_TLS_REJECT_UNAUTHORIZED === '0') {
    log('NODE_TLS_REJECT_UNAUTHORIZED is 0, so the token could be read on its way to Figma; unset it first.')
    return 1
  }
  const link = parseFigmaLink(args[0] ?? '')
  if ('error' in link) {
    log(`${link.error}\nUsage: pnpm --filter @dazbee/figma record '<link to a Figma design file>'`)
    return 1
  }
  try {
    log(link.nodeId ? `Reading node ${link.nodeId} from Figma…` : 'Reading the file from Figma…')
    const summary = await record({ apiBase: FIGMA_API, token, ...link, outDir: RECORDED_DIR })
    for (const line of summaryLines(summary)) log(line)
    return 0
  } catch (error) {
    log(redact(error instanceof Error ? error.message : 'The recording failed.', token))
    return 1
  }
}

/** Calls to the Figma API, each with the token, to its origin alone, following no redirect. */
function apiClient(options: RecordOptions) {
  const origin = new URL(options.apiBase).origin
  const json = async (path: string, query: Record<string, string>, what: string): Promise<FileJson> => {
    const url = new URL(path, origin)
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v)
    if (url.origin !== origin) throw new Error(`Refused to send the token outside ${origin}.`)
    let response: Response
    try {
      response = await fetch(url, {
        headers: { 'X-Figma-Token': options.token },
        redirect: 'error',
        signal: AbortSignal.timeout(API_MS),
      })
    } catch (error) {
      throw new Error(
        isTimeout(error)
          ? `Figma took longer than ${API_MS / 1000} s to answer for ${what}.`
          : `Figma could not be reached for ${what}, or answered with a redirect, which is not followed.`,
      )
    }
    const body = await readCapped(response, ANSWER_BYTES).catch(() => null)
    const text = body ? new TextDecoder().decode(body) : ''
    if (!response.ok) throw new Error(redact(statusMessage(response, text, what, options.token), options.token))
    if (!body) throw new Error(`Figma’s answer for ${what} was larger than ${ANSWER_BYTES / 1024 / 1024} MB.`)
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      throw new Error(`Figma’s answer for ${what} was not JSON.`)
    }
    const fields = asRecord(parsed)
    if (!fields) throw new Error(`Figma’s answer for ${what} was not a JSON object.`)
    return { ...fields }
  }
  return { json }
}

/** The file's document read as nodes, or an error naming why the file can't be recorded. */
function designDocument(file: FileJson): FigmaNode {
  const read = readFigmaFile(JSON.stringify(file))
  if (!('error' in read)) return read.document
  throw new Error(
    read.error === 'too-many-nodes'
      ? `The file has more than ${MAX_FIGMA_NODES} nodes, more than Dazbee imports; record a smaller file.`
      : read.error === 'too-deep'
        ? 'The file nests its layers deeper than Dazbee imports; record a flatter file.'
        : 'The link is not a Figma design file.',
  )
}

function recordNodeLink(
  options: RecordOptions,
  file: FileJson,
  document: FigmaNode,
  thumbnail: string[],
): RecordSummary {
  const pageReturned = document.children.some((n) => n.type === 'CANVAS')
  file.recording = { nodeId: options.nodeId, pageReturned }
  mkdirSync(options.outDir, { recursive: true })
  writeFileSync(join(options.outDir, 'node-link.json'), cleanJson(file, [options.token, ...thumbnail]))
  return { kind: 'node', pageReturned }
}

/** The visible top-level frames, components and instances of every page, through sections. */
function topFrames(document: FigmaNode): Frame[] {
  const frames: Frame[] = []
  const pages = document.children.filter((n) => n.type === 'CANVAS')
  const stack = pages.flatMap((p) => p.children).reverse()
  for (let node = stack.pop(); node; node = stack.pop()) {
    if (node.fields.visible === false) continue
    if (node.type === 'SECTION') stack.push(...[...node.children].reverse())
    else if (FRAME_TYPES.has(node.type) && NODE_ID.test(node.id)) frames.push({ id: node.id, name: node.name })
  }
  return frames
}

/** Saves each image fill's bytes as `images/<imageRef>.<type>`, listing every one that fails. */
async function saveImages(urls: Map<string, unknown>, staging: string, allowHttp?: boolean): Promise<Saved> {
  const result: Saved = { saved: {}, failed: [] }
  for (const [ref, url] of urls) {
    const got = IMAGE_REF.test(ref) ? await download(url, MAX_UPLOAD_BYTES, allowHttp) : { reason: UNSAFE_NAME_REASON }
    if ('reason' in got) {
      result.failed.push({ imageRef: ref, reason: got.reason })
      continue
    }
    const file = `images/${ref}.${got.extension}`
    writeFileSync(join(staging, file), got.bytes)
    result.saved[ref] = file
  }
  return result
}

/** Saves Figma's PNG of each frame as `figma/<id>.png`, `1:2` as `1-2`, listing every one that fails. */
async function saveRenders(
  frames: Frame[],
  urls: Map<string, unknown>,
  staging: string,
  allowHttp?: boolean,
): Promise<Saved> {
  const result: Saved = { saved: {}, failed: [] }
  for (const frame of frames) {
    const got = await download(urls.get(frame.id), RENDER_BYTES, allowHttp)
    if ('reason' in got || got.extension !== 'png') {
      result.failed.push({ ...frame, reason: 'reason' in got ? got.reason : 'Figma’s render is not a PNG' })
      continue
    }
    const file = `figma/${frame.id.replaceAll(':', '-').replaceAll(';', '_')}.png`
    writeFileSync(join(staging, file), got.bytes)
    result.saved[frame.id] = { name: frame.name, file }
  }
  return result
}

function hostsOf(urls: Iterable<unknown>): string[] {
  const hosts = new Set<string>()
  for (const url of urlStrings(urls)) {
    try {
      hosts.add(new URL(url).host)
    } catch {
      // A value that is no URL has no host to list.
    }
  }
  return [...hosts].sort()
}

/** The file as indented JSON; throws, writing nothing, when it holds the token or a recorded URL. */
function cleanJson(file: FileJson, secrets: string[]): string {
  const text = `${JSON.stringify(file, null, 2)}\n`
  for (const secret of secrets)
    if (secret && text.includes(secret)) throw new Error('The recording held the token or a URL; nothing was written.')
  return text
}

function summaryLines(s: RecordSummary): string[] {
  if (s.kind === 'node')
    return [
      `Saved ${join(RECORDED_DIR, 'node-link.json')}.`,
      s.pageReturned ? 'Figma returned the node with its page.' : 'Figma returned the node without its page.',
    ]
  return [
    `Saved the recording in ${RECORDED_DIR}:`,
    `  file.json, ${s.images} images (${s.failedImages} failed), ${s.renders} frame renders (${s.failedRenders} failed).`,
    `  Image hosts: ${s.imageHosts.join(', ') || 'none'}.`,
    'Failed images and renders are listed in file.json under "recording".',
  ]
}

/** Figma's status for `what`, its own words with the token redacted, and what to do next. */
function statusMessage(response: Response, text: string, what: string, token: string): string {
  const lines = [`Figma answered ${response.status} for ${what}.`]
  let said: unknown
  try {
    const body = asRecord(JSON.parse(text))
    said = body?.err ?? body?.message
  } catch {
    said = undefined
  }
  if (typeof said === 'string' && said) lines.push(`Figma said: ${redact(said, token).slice(0, 200)}`)
  if (response.status === 403)
    lines.push('The token may have expired, lack the File content: read scope, or belong to someone without access.')
  if (response.status === 404) lines.push('Figma has no file with that key; check the link.')
  if (response.status === 429) {
    const after = response.headers.get('retry-after')
    lines.push(after ? `Try again in ${after} s.` : 'Try again later.')
    if (response.headers.get('x-figma-rate-limit-type') === 'low')
      lines.push('Figma allows View and Collab seats about 20 file reads a month.')
  }
  return lines.join('\n')
}

function urlStrings(values: Iterable<unknown>): string[] {
  return [...values].filter((v): v is string => typeof v === 'string')
}

if (import.meta.main ?? process.argv[1] === import.meta.filename) {
  process.exitCode = await main(process.argv.slice(2), process.env)
}
