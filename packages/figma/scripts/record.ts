// Records one real Figma file for the pixel harness: its JSON with `geometry=paths`, the bytes of
// its image fills and Figma's own PNG of each top-level frame at scale 1. Run by hand, never in CI:
//
//   FIGMA_TOKEN=<personal access token> pnpm --filter @dazbee/figma record '<link>'
//
// The token goes only to https://api.figma.com, as `X-Figma-Token`, and is written nowhere: image
// and render downloads (download.ts) are never given the token, the API's redirects are refused, and every error is redacted.
// A link with a `node-id` records only `/files?ids=` for that node, as `node-link.json`.
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { MAX_UPLOAD_BYTES } from '@dazbee/schema'

import { FRAME_TYPES } from '../src/layers.ts'
import { download, isTimeout, readCapped } from './download.ts'

export interface RecordOptions {
  /** The Figma API's origin; the command line always passes `FIGMA_API`. */
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

export interface RecordSummary {
  /** The files written, relative to the recording's folder. */
  written: string[]
  images: number
  failedImages: number
  renders: number
  failedRenders: number
  imageHosts: string[]
  /** For a node link, whether `/files?ids=` returned the node's page along with it. */
  pageReturned?: boolean
}

type Json = Record<string, unknown>

interface Frame {
  id: string
  name: string
}

export const FIGMA_API = 'https://api.figma.com'
/** Where the recording lands: `tests/pixels/fixtures/figma/recorded` at the repo's root. */
export const RECORDED_DIR = fileURLToPath(new URL('../../../tests/pixels/fixtures/figma/recorded', import.meta.url))

const FILE_BYTES = 200 * 1024 * 1024
const RENDER_BYTES = 100 * 1024 * 1024
const API_MS = 120_000
const KEY = /^[A-Za-z0-9]{1,128}$/
const NODE_ID = /^[A-Za-z0-9:;]{1,64}$/
const IMAGE_REF = /^[A-Za-z0-9]{1,128}$/
const UNSAFE_NAME = 'not a name the recording can save'

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

/** Records the file `options.key` names; throws with a message that never holds the token. */
export async function record(options: RecordOptions): Promise<RecordSummary> {
  if (!KEY.test(options.key) || (options.nodeId !== undefined && !NODE_ID.test(options.nodeId)))
    throw new Error('The file key or node id is not one Figma makes.')
  const api = apiClient(options)
  const fileQuery: Record<string, string> = { geometry: 'paths' }
  if (options.nodeId) fileQuery.ids = options.nodeId
  const file = await api.json(`/v1/files/${options.key}`, fileQuery, FILE_BYTES, 'the file')
  if (file.editorType !== 'figma') throw new Error('The link is not a Figma design file.')
  const thumbnail = typeof file.thumbnailUrl === 'string' ? [file.thumbnailUrl] : []
  delete file.thumbnailUrl
  if (options.nodeId) return recordNodeLink(options, file, thumbnail)

  const imagesAnswer = await api.json(`/v1/files/${options.key}/images`, {}, FILE_BYTES, 'the image list')
  const imageUrls = urlMap(field(imagesAnswer, 'meta', 'images') ?? imagesAnswer.images)
  const frames = topFrames(file.document)
  const renderUrls =
    frames.length === 0
      ? new Map<string, unknown>()
      : urlMap(
          (
            await api.json(
              `/v1/images/${options.key}`,
              { ids: frames.map((f) => f.id).join(','), format: 'png', scale: '1', use_absolute_bounds: 'true' },
              FILE_BYTES,
              'the frame renders',
            )
          ).images,
        )

  const staging = `${options.outDir}.partial`
  rmSync(staging, { recursive: true, force: true })
  mkdirSync(join(staging, 'images'), { recursive: true })
  mkdirSync(join(staging, 'figma'), { recursive: true })
  const written: string[] = []

  const images: Json = {}
  const failedImages: Json[] = []
  for (const [ref, url] of imageUrls) {
    const got = IMAGE_REF.test(ref) ? await download(url, MAX_UPLOAD_BYTES, options.allowHttp) : { reason: UNSAFE_NAME }
    if ('reason' in got) {
      failedImages.push({ imageRef: ref, reason: got.reason })
      continue
    }
    const name = `images/${ref}.${got.extension}`
    writeFileSync(join(staging, name), got.bytes)
    images[ref] = name
    written.push(name)
  }

  const renders: Json = {}
  const failedRenders: Json[] = []
  for (const frame of frames) {
    const got = await download(renderUrls.get(frame.id), RENDER_BYTES, options.allowHttp)
    if ('reason' in got || got.extension !== 'png') {
      failedRenders.push({ ...frame, reason: 'reason' in got ? got.reason : 'Figma’s render is not a PNG' })
      continue
    }
    const name = `figma/${frame.id.replaceAll(':', '-').replaceAll(';', '_')}.png`
    writeFileSync(join(staging, name), got.bytes)
    renders[frame.id] = { name: frame.name, file: name }
    written.push(name)
  }

  const imageHosts = hostsOf(imageUrls.values())
  file.recording = {
    imageHosts,
    renderHosts: hostsOf(renderUrls.values()),
    images,
    failedImages,
    renders,
    failedRenders,
  }
  const secrets = [options.token, ...thumbnail, ...urlStrings(imageUrls.values()), ...urlStrings(renderUrls.values())]
  writeFileSync(join(staging, 'file.json'), cleanJson(file, secrets))
  written.unshift('file.json')

  rmSync(options.outDir, { recursive: true, force: true })
  mkdirSync(dirname(options.outDir), { recursive: true })
  renameSync(staging, options.outDir)
  return {
    written,
    images: Object.keys(images).length,
    failedImages: failedImages.length,
    renders: Object.keys(renders).length,
    failedRenders: failedRenders.length,
    imageHosts,
  }
}

/** `text` with every copy of `token` replaced by `[FIGMA_TOKEN]`. */
export function redact(text: string, token: string): string {
  return token ? text.replaceAll(token, '[FIGMA_TOKEN]') : text
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
  const link = parseFigmaLink(args[0] ?? '')
  if ('error' in link) {
    log(`${link.error}\nUsage: pnpm --filter @dazbee/figma record '<link to a Figma design file>'`)
    return 1
  }
  try {
    log(link.nodeId ? `Reading node ${link.nodeId} from Figma…` : 'Reading the file from Figma…')
    const outDir = RECORDED_DIR
    const summary = await record({ apiBase: FIGMA_API, token, ...link, outDir })
    for (const line of summaryLines(summary, outDir)) log(line)
    return 0
  } catch (error) {
    log(redact(error instanceof Error ? error.message : 'The recording failed.', token))
    return 1
  }
}

function recordNodeLink(options: RecordOptions, file: Json, thumbnail: string[]): RecordSummary {
  const pageReturned = pagesOf(file.document).length > 0
  file.recording = { nodeId: options.nodeId, pageReturned }
  mkdirSync(options.outDir, { recursive: true })
  writeFileSync(join(options.outDir, 'node-link.json'), cleanJson(file, [options.token, ...thumbnail]))
  return {
    written: ['node-link.json'],
    images: 0,
    failedImages: 0,
    renders: 0,
    failedRenders: 0,
    imageHosts: [],
    pageReturned,
  }
}

/** Calls to the Figma API, each with the token, to its origin alone, following no redirect. */
function apiClient(options: RecordOptions) {
  const origin = new URL(options.apiBase).origin
  const json = async (path: string, query: Record<string, string>, cap: number, what: string): Promise<Json> => {
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
    const body = await readCapped(response, cap).catch(() => null)
    const text = body ? new TextDecoder().decode(body) : ''
    if (!response.ok) throw new Error(redact(statusMessage(response, text, what), options.token))
    if (!body) throw new Error(`Figma’s answer for ${what} was larger than ${cap / 1024 / 1024} MB.`)
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      throw new Error(`Figma’s answer for ${what} was not JSON.`)
    }
    if (!isJson(parsed)) throw new Error(`Figma’s answer for ${what} was not a JSON object.`)
    return parsed
  }
  return { json }
}

function statusMessage(response: Response, text: string, what: string): string {
  const lines = [`Figma answered ${response.status} for ${what}.`]
  let said: unknown
  try {
    const body: unknown = JSON.parse(text)
    said = isJson(body) ? (body.err ?? body.message) : undefined
  } catch {
    said = undefined
  }
  if (typeof said === 'string' && said) lines.push(`Figma said: ${said.slice(0, 200)}`)
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

/** The file as indented JSON; throws, writing nothing, when it holds the token or a recorded URL. */
function cleanJson(file: Json, secrets: string[]): string {
  const text = `${JSON.stringify(file, null, 2)}\n`
  for (const secret of secrets)
    if (secret && text.includes(secret)) throw new Error('The recording held the token or a URL; nothing was written.')
  return text
}

/** A map from Figma's JSON as own entries, so no key reaches an object's prototype. */
function urlMap(value: unknown): Map<string, unknown> {
  return new Map(isJson(value) ? Object.entries(value) : [])
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

function urlStrings(values: Iterable<unknown>): string[] {
  return [...values].filter((v): v is string => typeof v === 'string')
}

/** The visible top-level frames, components and instances of every page, through sections. */
function topFrames(document: unknown): Frame[] {
  const frames: Frame[] = []
  const stack = pagesOf(document).flatMap(childrenOf).reverse()
  for (let node = stack.pop(); node; node = stack.pop()) {
    if (node.visible === false || typeof node.id !== 'string') continue
    if (node.type === 'SECTION') stack.push(...childrenOf(node).reverse())
    else if (typeof node.type === 'string' && FRAME_TYPES.has(node.type))
      frames.push({ id: node.id, name: typeof node.name === 'string' ? node.name : '' })
  }
  return frames.filter((f) => NODE_ID.test(f.id))
}

function pagesOf(document: unknown): Json[] {
  return isJson(document) ? childrenOf(document).filter((n) => n.type === 'CANVAS') : []
}

function childrenOf(node: Json): Json[] {
  return Array.isArray(node.children) ? node.children.filter(isJson) : []
}

function field(value: unknown, ...path: string[]): unknown {
  let at = value
  for (const key of path) at = isJson(at) && Object.hasOwn(at, key) ? at[key] : undefined
  return at
}

function isJson(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function summaryLines(s: RecordSummary, outDir: string): string[] {
  if (s.pageReturned !== undefined)
    return [
      `Saved ${join(outDir, 'node-link.json')}.`,
      s.pageReturned ? 'Figma returned the node with its page.' : 'Figma returned the node without its page.',
    ]
  return [
    `Saved the recording in ${outDir}:`,
    `  file.json, ${s.images} images (${s.failedImages} failed), ${s.renders} frame renders (${s.failedRenders} failed).`,
    `  Image hosts: ${s.imageHosts.join(', ') || 'none'}.`,
    'Failed images and renders are listed in file.json under "recording".',
  ]
}

if (import.meta.main ?? process.argv[1] === import.meta.filename) {
  process.exitCode = await main(process.argv.slice(2), process.env)
}
