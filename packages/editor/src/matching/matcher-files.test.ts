import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import release from '@dazbee/matchers/release' with { type: 'json' }

import {
  fileBytes,
  type FileDeps,
  forgetOldFiles,
  MATCHER_CACHE,
  type MatcherFile,
  ONNX_RUNTIME_VERSION,
  ONNX_RUNTIME_WASM,
  textMatcherFile,
} from './matcher-files.ts'

/** A stand-in Cache Storage of one cache, keyed by absolute address as a browser keys it. */
function cacheStorage() {
  const kept = new Map<string, Uint8Array>()
  const opened: string[] = []
  const absolute = (url: string) => new URL(url, 'https://app.example').href
  const cache = {
    async match(url: string) {
      const bytes = kept.get(absolute(url))
      return bytes ? new Response(new Uint8Array(bytes)) : undefined
    },
    async put(url: string, response: Response) {
      kept.set(absolute(url), new Uint8Array(await response.arrayBuffer()))
    },
    async keys() {
      return [...kept.keys()].map((url) => ({ url }) as Request)
    },
    async delete(request: Request) {
      return kept.delete(request.url)
    },
  }
  const caches = {
    async open(name: string) {
      opened.push(name)
      return cache as unknown as Cache
    },
  }
  return { caches, kept, opened, absolute }
}

const BYTES = new Uint8Array([1, 2, 3, 4])
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const FILE: MatcherFile = { url: `/matchers/${sha256(BYTES)}.bin`, sha256: sha256(BYTES) }

/** Deps whose fetch answers `bytes` for every address, counting its asks. */
function deps(bytes: Uint8Array, storage = cacheStorage()): FileDeps & { fetch: ReturnType<typeof vi.fn> } {
  return {
    caches: storage.caches,
    fetch: vi.fn(async () => new Response(new Uint8Array(bytes))),
  }
}

describe('fileBytes', () => {
  it('fetches a file once, keeps it in Cache Storage and reads it back from there', async () => {
    const storage = cacheStorage()
    const files = deps(BYTES, storage)
    expect(await fileBytes(FILE, files)).toEqual(BYTES)
    expect(await fileBytes(FILE, files)).toEqual(BYTES)
    expect(files.fetch).toHaveBeenCalledTimes(1)
    expect(storage.opened.every((name) => name === MATCHER_CACHE)).toBe(true)
    expect(storage.kept.get(storage.absolute(FILE.url))).toEqual(BYTES)
  })

  it('keeps no file whose SHA-256 isn’t its name’s, and refuses it', async () => {
    const storage = cacheStorage()
    const files = deps(new Uint8Array([9, 9]), storage)
    await expect(fileBytes(FILE, files)).rejects.toThrow('is not the file its address names')
    expect(storage.kept.size).toBe(0)
  })

  it('keeps ONNX Runtime’s WebAssembly by its version, and fetches each time where there is no Cache Storage', async () => {
    const files = deps(BYTES, cacheStorage())
    await fileBytes(ONNX_RUNTIME_WASM, files)
    await fileBytes(ONNX_RUNTIME_WASM, files)
    expect(files.fetch).toHaveBeenCalledTimes(1)
    const uncached = { fetch: vi.fn(async () => new Response(new Uint8Array(BYTES))) }
    await fileBytes(FILE, uncached)
    await fileBytes(FILE, uncached)
    expect(uncached.fetch).toHaveBeenCalledTimes(2)
  })

  it('refuses a file that doesn’t come, and keeps nothing', async () => {
    const storage = cacheStorage()
    const files = { caches: storage.caches, fetch: async () => new Response('', { status: 404 }) }
    await expect(fileBytes(FILE, files)).rejects.toThrow('404')
    expect(storage.kept.size).toBe(0)
  })
})

describe('forgetOldFiles', () => {
  it('deletes kept files the release and runtime no longer name, and keeps theirs', async () => {
    const storage = cacheStorage()
    const model = textMatcherFile('text-model.onnx')
    storage.kept.set(storage.absolute(model.url), BYTES)
    storage.kept.set(storage.absolute(FILE.url), BYTES)
    await forgetOldFiles({ caches: storage.caches, fetch })
    expect([...storage.kept.keys()]).toEqual([storage.absolute(model.url)])
  })
})

describe('the matcher’s files', () => {
  it('names each release file at its permanent address', () => {
    expect(textMatcherFile('text-model.onnx')).toEqual({
      url: `/matchers/${release.files['text-model.onnx'].sha256}.bin`,
      sha256: release.files['text-model.onnx'].sha256,
    })
  })

  it('names the ONNX Runtime Web the editor depends on', () => {
    const wasm = createRequire(import.meta.url).resolve('onnxruntime-web/ort-wasm-simd-threaded.wasm')
    const installed = JSON.parse(readFileSync(join(dirname(wasm), '..', 'package.json'), 'utf8')) as { version: string }
    expect(ONNX_RUNTIME_VERSION).toBe(installed.version)
  })
})
