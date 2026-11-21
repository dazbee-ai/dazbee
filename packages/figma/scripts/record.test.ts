import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { main, parseFigmaLink, record, redact } from './record.ts'

interface Seen {
  url: string
  headers: IncomingHttpHeaders
}

interface Stub {
  base: string
  host: string
  seen: Seen[]
  close: () => Promise<void>
}

type Route = (url: URL) => { status: number; body: string | Uint8Array; headers?: Record<string, string> }

const TOKEN = 'figd_test-token-that-must-not-leak'
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 4, 5, 6])
const REF_A = 'a'.repeat(40)
const REF_B = 'b'.repeat(40)
const REF_C = 'c'.repeat(40)

const stubs: Stub[] = []
let dir: string

const startStub = async (route: Route): Promise<Stub> => {
  const seen: Seen[] = []
  const server: Server = createServer((req, res) => {
    seen.push({ url: req.url ?? '', headers: req.headers })
    const answer = route(new URL(req.url ?? '/', 'http://stub'))
    res.writeHead(answer.status, answer.headers ?? {})
    res.end(answer.body)
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const { port } = server.address() as AddressInfo
  const stub = {
    base: `http://127.0.0.1:${port}`,
    host: `127.0.0.1:${port}`,
    seen,
    close: () => new Promise<void>((done) => server.close(() => done())),
  }
  stubs.push(stub)
  return stub
}

const figmaFile = (cdn: Stub) => ({
  name: 'Recipe',
  editorType: 'figma',
  thumbnailUrl: `${cdn.base}/thumbnail`,
  document: {
    id: '0:0',
    type: 'DOCUMENT',
    children: [
      {
        id: '0:1',
        type: 'CANVAS',
        name: 'Risks',
        children: [
          { id: '1:2', type: 'FRAME', name: 'Angular', children: [] },
          { id: '1:3', type: 'FRAME', name: 'Hidden', visible: false, children: [] },
          {
            id: '1:4',
            type: 'SECTION',
            name: 'Section',
            children: [{ id: '1:5', type: 'COMPONENT', name: 'Card', children: [] }],
          },
          { id: '1:6', type: 'RECTANGLE', name: 'Loose', children: [] },
        ],
      },
    ],
  },
})

/** A Figma API stub that answers the file, images and render calls, pointing every URL at `cdn`. */
const figmaApi = (cdn: Stub, overrides: Partial<Record<'file' | 'images' | 'render', Route>> = {}) =>
  startStub((url) => {
    if (/^\/v1\/files\/[^/]+$/.test(url.pathname))
      return overrides.file?.(url) ?? { status: 200, body: JSON.stringify(figmaFile(cdn)) }
    if (/^\/v1\/files\/[^/]+\/images$/.test(url.pathname))
      return (
        overrides.images?.(url) ?? {
          status: 200,
          body: JSON.stringify({
            error: false,
            status: 200,
            meta: {
              images: {
                [REF_A]: `${cdn.base}/img/a`,
                [REF_B]: `${cdn.base}/img/b`,
                [REF_C]: `${cdn.base}/missing`,
                '../escape': `${cdn.base}/img/a`,
                ['__proto__']: `${cdn.base}/img/a`,
              },
            },
          }),
        }
      )
    if (/^\/v1\/images\/[^/]+$/.test(url.pathname))
      return (
        overrides.render?.(url) ?? {
          status: 200,
          body: JSON.stringify({
            err: null,
            images: { '1:2': `${cdn.base}/render/1-2`, '1:5': `${cdn.base}/render/1-5` },
          }),
        }
      )
    return { status: 404, body: '' }
  })

const cdnStub = () =>
  startStub((url) => {
    if (url.pathname === '/img/a') return { status: 200, body: PNG }
    if (url.pathname === '/img/b') return { status: 200, body: JPEG }
    if (url.pathname.startsWith('/render/')) return { status: 200, body: PNG }
    return { status: 404, body: 'gone' }
  })

const run = (api: Stub, out: string, nodeId?: string) =>
  record({
    apiBase: api.base,
    token: TOKEN,
    key: 'KEY123',
    ...(nodeId ? { nodeId } : {}),
    outDir: out,
    allowHttp: true,
  })

/** Every file under `root`, as its text. */
const allText = (root: string): string =>
  readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => readFileSync(join(e.parentPath, e.name), 'latin1'))
    .join('\n')

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'figma-record-'))
})

afterEach(async () => {
  await Promise.all(stubs.splice(0).map((s) => s.close()))
  rmSync(dir, { recursive: true, force: true })
})

describe('parseFigmaLink', () => {
  it('reads the key from a file or design link, with or without www', () => {
    expect(parseFigmaLink('https://www.figma.com/design/AbC123xyz/My-file')).toEqual({ key: 'AbC123xyz' })
    expect(parseFigmaLink('https://figma.com/file/AbC123xyz/My-file?t=1')).toEqual({ key: 'AbC123xyz' })
  })

  it('reads a branch key and a node id in the API form', () => {
    expect(parseFigmaLink('https://www.figma.com/design/AbC123/branch/Br4nch/My-file')).toEqual({ key: 'Br4nch' })
    expect(parseFigmaLink('https://www.figma.com/design/AbC123/My-file?node-id=12-34&t=x')).toEqual({
      key: 'AbC123',
      nodeId: '12:34',
    })
    expect(parseFigmaLink('https://www.figma.com/design/AbC123/F?node-id=I1-2%3B3-4')).toEqual({
      key: 'AbC123',
      nodeId: 'I1:2;3:4',
    })
  })

  it('refuses another host, another kind of file, or no key', () => {
    expect(parseFigmaLink('https://evil.example/design/AbC123/F')).toHaveProperty('error')
    expect(parseFigmaLink('https://www.figma.com.evil.example/design/AbC123/F')).toHaveProperty('error')
    expect(parseFigmaLink('http://www.figma.com/design/AbC123/F')).toHaveProperty('error')
    expect(parseFigmaLink('https://www.figma.com/board/AbC123/F')).toHaveProperty('error')
    expect(parseFigmaLink('https://www.figma.com/design/')).toHaveProperty('error')
    expect(parseFigmaLink('https://www.figma.com/design/Ab..C/F')).toHaveProperty('error')
    expect(parseFigmaLink('https://www.figma.com/design/AbC123/F?node-id=1-2/../x')).toHaveProperty('error')
    expect(parseFigmaLink('not a link')).toHaveProperty('error')
  })
})

describe('record', () => {
  it('makes exactly the file call, one images call and one render call, each with the token', async () => {
    const cdn = await cdnStub()
    const api = await figmaApi(cdn)
    await run(api, join(dir, 'recorded'))
    const paths = api.seen.map((s) => new URL(s.url, 'http://stub'))
    expect(paths.map((u) => u.pathname)).toEqual(['/v1/files/KEY123', '/v1/files/KEY123/images', '/v1/images/KEY123'])
    expect(paths[0]?.searchParams.get('geometry')).toBe('paths')
    expect(paths[0]?.searchParams.has('ids')).toBe(false)
    expect(Object.fromEntries(paths[2]?.searchParams ?? [])).toEqual({
      ids: '1:2,1:5',
      format: 'png',
      scale: '1',
      use_absolute_bounds: 'true',
    })
    for (const s of api.seen) expect(s.headers['x-figma-token']).toBe(TOKEN)
  })

  it('sends the token to no other origin, in no header or URL', async () => {
    const cdn = await cdnStub()
    const api = await figmaApi(cdn)
    await run(api, join(dir, 'recorded'))
    expect(cdn.seen.length).toBeGreaterThan(0)
    for (const s of cdn.seen) {
      expect(s.url).not.toContain(TOKEN)
      expect(JSON.stringify(s.headers)).not.toContain(TOKEN)
      expect(s.headers['x-figma-token']).toBeUndefined()
      expect(s.headers.authorization).toBeUndefined()
    }
    for (const s of api.seen) expect(s.url).not.toContain(TOKEN)
  })

  it('writes the file, its images and the renders, with no token or image URL in them', async () => {
    const cdn = await cdnStub()
    const api = await figmaApi(cdn)
    const out = join(dir, 'recorded')
    await run(api, out)
    expect(readFileSync(join(out, 'images', `${REF_A}.png`))).toEqual(Buffer.from(PNG))
    expect(readFileSync(join(out, 'images', `${REF_B}.jpg`))).toEqual(Buffer.from(JPEG))
    expect(readFileSync(join(out, 'figma', '1-2.png'))).toEqual(Buffer.from(PNG))
    expect(readFileSync(join(out, 'figma', '1-5.png'))).toEqual(Buffer.from(PNG))
    const saved = allText(out)
    expect(saved).not.toContain(TOKEN)
    expect(saved).not.toContain(cdn.base)
    const file = JSON.parse(readFileSync(join(out, 'file.json'), 'utf8'))
    expect(file.name).toBe('Recipe')
    expect(file.document.children[0].children[0]).toEqual({ id: '1:2', type: 'FRAME', name: 'Angular', children: [] })
    expect(file.thumbnailUrl).toBeUndefined()
    expect(file.recording.images).toEqual({ [REF_A]: `images/${REF_A}.png`, [REF_B]: `images/${REF_B}.jpg` })
    expect(file.recording.renders).toEqual({
      '1:2': { name: 'Angular', file: 'figma/1-2.png' },
      '1:5': { name: 'Card', file: 'figma/1-5.png' },
    })
  })

  it('lists an image host once, and a failed image, and goes on', async () => {
    const cdn = await cdnStub()
    const api = await figmaApi(cdn)
    const out = join(dir, 'recorded')
    const summary = await run(api, out)
    const file = JSON.parse(readFileSync(join(out, 'file.json'), 'utf8'))
    expect(file.recording.imageHosts).toEqual([cdn.host])
    expect(file.recording.renderHosts).toEqual([cdn.host])
    expect(file.recording.failedImages).toEqual([
      { imageRef: REF_C, reason: 'Figma’s storage answered 404' },
      { imageRef: '../escape', reason: 'not a name the recording can save' },
      { imageRef: '__proto__', reason: 'not a name the recording can save' },
    ])
    expect(summary).toMatchObject({ kind: 'file', images: 2, failedImages: 3, renders: 2 })
    expect(readdirSync(join(out, 'images')).sort()).toEqual([`${REF_A}.png`, `${REF_B}.jpg`])
    expect(existsSync(join(dir, 'escape'))).toBe(false)
    expect(Object.prototype).not.toHaveProperty('imageRef')
  })

  it('reads an images answer whose map is at the top level', async () => {
    const cdn = await cdnStub()
    const images: Route = () => ({ status: 200, body: JSON.stringify({ images: { [REF_A]: `${cdn.base}/img/a` } }) })
    const api = await figmaApi(cdn, { images })
    const out = join(dir, 'recorded')
    await run(api, out)
    expect(readdirSync(join(out, 'images'))).toEqual([`${REF_A}.png`])
  })

  it('lists an image that is not https, a render Figma could not make, and bytes that are no image', async () => {
    const cdn = await cdnStub()
    const images: Route = () => ({ status: 200, body: JSON.stringify({ meta: { images: { [REF_A]: null } } }) })
    const render: Route = () => ({
      status: 200,
      body: JSON.stringify({ err: null, images: { '1:2': null, '1:5': `${cdn.base}/missing` } }),
    })
    const api = await figmaApi(cdn, { images, render })
    const out = join(dir, 'recorded')
    await record({ apiBase: api.base, token: TOKEN, key: 'KEY123', outDir: out })
    const file = JSON.parse(readFileSync(join(out, 'file.json'), 'utf8'))
    expect(file.recording.failedImages).toEqual([{ imageRef: REF_A, reason: 'Figma gave no URL' }])
    expect(file.recording.failedRenders).toEqual([
      { id: '1:2', name: 'Angular', reason: 'Figma gave no URL' },
      { id: '1:5', name: 'Card', reason: 'not an https URL' },
    ])
  })

  it('names Figma’s status and words with the token redacted, and keeps the earlier recording', async () => {
    const cdn = await cdnStub()
    const file: Route = () => ({ status: 403, body: JSON.stringify({ status: 403, err: `Invalid token ${TOKEN}` }) })
    const api = await figmaApi(cdn, { file })
    const out = join(dir, 'recorded')
    mkdirSync(out)
    writeFileSync(join(out, 'file.json'), 'earlier')
    const error = await run(api, out).catch((e: Error) => e)
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toContain('403')
    expect((error as Error).message).toContain('Invalid token [FIGMA_TOKEN]')
    expect((error as Error).message).not.toContain(TOKEN)
    expect(readFileSync(join(out, 'file.json'), 'utf8')).toBe('earlier')
    expect(api.seen).toHaveLength(1)
  })

  it('redacts the token in Figma’s words before cutting them short', async () => {
    const cdn = await cdnStub()
    // A token not shaped like a Figma one, so only the redaction of the token in use can catch it.
    const token = 'plain-token-0123456789abcdef'
    const err = `${'x'.repeat(190)}${token}`
    const file: Route = () => ({ status: 400, body: JSON.stringify({ status: 400, err }) })
    const api = await figmaApi(cdn, { file })
    const options = { apiBase: api.base, token, key: 'KEY123', outDir: join(dir, 'recorded') }
    const error = (await record(options).catch((e: Error) => e)) as Error
    expect(error.message).toContain('400')
    expect(error.message).not.toContain(token.slice(0, 10))
  })

  it('says when to try again after a 429, and tries no second time', async () => {
    const cdn = await cdnStub()
    const file: Route = () => ({
      status: 429,
      body: '{}',
      headers: { 'retry-after': '120', 'x-figma-rate-limit-type': 'low' },
    })
    const api = await figmaApi(cdn, { file })
    const error = (await run(api, join(dir, 'recorded')).catch((e: Error) => e)) as Error
    expect(error.message).toContain('429')
    expect(error.message).toContain('120 s')
    expect(error.message).toContain('View and Collab')
    expect(api.seen).toHaveLength(1)
  })

  it('follows no redirect from the API, so the token goes nowhere else', async () => {
    const cdn = await cdnStub()
    const file: Route = () => ({ status: 302, body: '', headers: { location: `${cdn.base}/elsewhere` } })
    const api = await figmaApi(cdn, { file })
    await expect(run(api, join(dir, 'recorded'))).rejects.toThrow()
    expect(cdn.seen).toHaveLength(0)
  })

  it('refuses a file that is no Figma design file', async () => {
    const cdn = await cdnStub()
    const file: Route = () => ({ status: 200, body: JSON.stringify({ ...figmaFile(cdn), editorType: 'figjam' }) })
    const api = await figmaApi(cdn, { file })
    await expect(run(api, join(dir, 'recorded'))).rejects.toThrow('not a Figma design file')
    expect(api.seen).toHaveLength(1)
  })

  it('records a link to one node as that file call alone, beside the recording', async () => {
    const cdn = await cdnStub()
    const api = await figmaApi(cdn)
    const out = join(dir, 'recorded')
    mkdirSync(out)
    writeFileSync(join(out, 'file.json'), 'earlier')
    const summary = await run(api, out, '1:5')
    expect(api.seen).toHaveLength(1)
    expect(new URL(api.seen[0]?.url ?? '', 'http://stub').searchParams.get('ids')).toBe('1:5')
    expect(summary).toEqual({ kind: 'node', pageReturned: true })
    const saved = JSON.parse(readFileSync(join(out, 'node-link.json'), 'utf8'))
    expect(saved.recording).toEqual({ nodeId: '1:5', pageReturned: true })
    expect(saved.thumbnailUrl).toBeUndefined()
    expect(readFileSync(join(out, 'file.json'), 'utf8')).toBe('earlier')
    expect(allText(out)).not.toContain(TOKEN)
  })

  it('keeps a node link recorded before when the whole file is recorded again', async () => {
    const cdn = await cdnStub()
    const api = await figmaApi(cdn)
    const out = join(dir, 'recorded')
    await run(api, out, '1:5')
    await run(api, out)
    expect(JSON.parse(readFileSync(join(out, 'node-link.json'), 'utf8')).recording.nodeId).toBe('1:5')
    expect(existsSync(join(out, 'file.json'))).toBe(true)
    expect(existsSync(`${out}.partial`)).toBe(false)
  })
})

describe('redact', () => {
  it('replaces every copy of the token', () => {
    expect(redact(`a ${TOKEN} b ${TOKEN}`, TOKEN)).toBe('a [FIGMA_TOKEN] b [FIGMA_TOKEN]')
  })

  it('replaces anything shaped like a Figma token, not only the one in use', () => {
    expect(redact('old figd_Another-Token_123 here', TOKEN)).toBe('old [FIGMA_TOKEN] here')
  })
})

describe('main', () => {
  it('asks for FIGMA_TOKEN when it is not set, and calls nothing', async () => {
    const lines: string[] = []
    const code = await main(['https://www.figma.com/design/AbC123/F'], {}, (l) => lines.push(l))
    expect(code).toBe(1)
    expect(lines.join('\n')).toContain('FIGMA_TOKEN')
  })

  it('refuses a token that could not be a header, without echoing it', async () => {
    const lines: string[] = []
    const env = { FIGMA_TOKEN: 'bad token\r\nX-Other: 1' }
    const code = await main(['https://www.figma.com/design/AbC123/F'], env, (l) => lines.push(l))
    expect(code).toBe(1)
    expect(lines.join('\n')).not.toContain('bad token')
  })

  it('takes the token out of the environment, so no child process inherits it', async () => {
    const env: Record<string, string | undefined> = { FIGMA_TOKEN: TOKEN }
    const lines: string[] = []
    const code = await main(['https://evil.example/design/AbC123/F'], env, (l) => lines.push(l))
    expect(code).toBe(1)
    expect(env.FIGMA_TOKEN).toBeUndefined()
    expect(lines.join('\n')).not.toContain(TOKEN)
  })

  it('refuses to run while certificates go unchecked, so the token can’t be read on its way', async () => {
    const lines: string[] = []
    const env = { FIGMA_TOKEN: TOKEN, NODE_TLS_REJECT_UNAUTHORIZED: '0' }
    const code = await main(['https://www.figma.com/design/AbC123/F'], env, (l) => lines.push(l))
    expect(code).toBe(1)
    expect(lines.join('\n')).toContain('NODE_TLS_REJECT_UNAUTHORIZED')
  })
})
