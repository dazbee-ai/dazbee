import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import type { ReleaseFile } from '../src/release-files.ts'
import { fetchFiles } from './fetch-files.ts'

/** Two small stand-in files of a release, by name. */
const BYTES: Record<string, Uint8Array> = {
  'text-model.onnx': new TextEncoder().encode('a stand-in model'),
  'text-keys.json': new TextEncoder().encode('["Roboto|400|normal"]\n'),
}
const FILES: ReleaseFile[] = Object.entries(BYTES).map(([name, bytes]) => ({
  name,
  sha256: createHash('sha256').update(bytes).digest('hex'),
  size: bytes.length,
}))

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** An empty folder for one test, and a download that counts what it is asked for. */
function setUp() {
  const dir = mkdtempSync(join(tmpdir(), 'matcher-files-'))
  dirs.push(dir)
  const asked: string[] = []
  const download = async (file: ReleaseFile) => {
    asked.push(file.name)
    return BYTES[file.name] ?? new Uint8Array()
  }
  return { dir, asked, download }
}

describe('fetchFiles', () => {
  it('downloads each file once, and keeps the whole files it finds on the next run', async () => {
    const { dir, asked, download } = setUp()
    expect(await fetchFiles({ dir, files: FILES, download })).toEqual({
      fetched: ['text-model.onnx', 'text-keys.json'],
      kept: [],
    })
    expect(await fetchFiles({ dir, files: FILES, download })).toEqual({
      fetched: [],
      kept: ['text-model.onnx', 'text-keys.json'],
    })
    expect(asked).toEqual(['text-model.onnx', 'text-keys.json'])
    expect(new Uint8Array(readFileSync(join(dir, 'text-keys.json')))).toEqual(BYTES['text-keys.json'])
  })

  it('downloads a file again when the one in place is different, however small the change', async () => {
    const { dir, asked, download } = setUp()
    await fetchFiles({ dir, files: FILES, download })
    writeFileSync(join(dir, 'text-model.onnx'), 'a stand-in modem')
    expect(await fetchFiles({ dir, files: FILES, download })).toEqual({
      fetched: ['text-model.onnx'],
      kept: ['text-keys.json'],
    })
    expect(asked).toEqual(['text-model.onnx', 'text-keys.json', 'text-model.onnx'])
    expect(new Uint8Array(readFileSync(join(dir, 'text-model.onnx')))).toEqual(BYTES['text-model.onnx'])
  })

  it('fails with a sentence naming the file when offline, and refuses bytes that are not the file', async () => {
    const { dir } = setUp()
    const offline = () => Promise.reject(new Error('fetch failed'))
    await expect(fetchFiles({ dir, files: FILES, download: offline })).rejects.toThrow(
      /^Couldn't download text-model\.onnx, a matcher file, from the release matchers-\w+ \(fetch failed\)/,
    )
    const wrong = () => Promise.resolve(new TextEncoder().encode('something else'))
    await expect(fetchFiles({ dir, files: FILES, download: wrong })).rejects.toThrow(
      /^text-model\.onnx as downloaded from the release matchers-\w+ is not the file release\.json lists$/,
    )
  })
})
