// Reading a tar archive as it streams, as GitHub's repository archives are written.
import { Readable } from 'node:stream'
import type { ReadableStream } from 'node:stream/web'
import { createGunzip } from 'node:zlib'

/** What the `tar` reader is told of each file: its path and its bytes; the reader waits for what it answers. */
export type TarFile = (path: string, bytes: Buffer) => void | Promise<void>

/** A tar block's size, which every header and every file's padded data is a whole number of. */
const BLOCK = 512

/**
 * Reads a tar stream, telling `onFile` each regular file's path and bytes and reading on once it is done, and answers
 * the commit the archive's global header names, as GitHub writes it. Long paths come in a pax header or a ustar
 * prefix.
 */
export async function readTar(stream: AsyncIterable<Buffer>, onFile: TarFile): Promise<string> {
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
        if (type === '0' || type === '\0') await onFile(path, Buffer.from(data))
        nextPath = undefined
      }
      pending = pending.subarray(length)
    }
  }
  return commit
}

export async function readGitHubArchive(
  { repository, commit }: { repository: string; commit: string },
  onFile: TarFile,
): Promise<void> {
  const response = await fetch(`https://codeload.github.com/${repository}/tar.gz/${commit}`)
  if (!response.ok || !response.body) throw new Error(`GitHub answered ${response.status} for ${repository}`)
  const body = Readable.fromWeb(response.body as ReadableStream<Uint8Array>).pipe(createGunzip())
  const archived = await readTar(body, (path, bytes) => onFile(path.slice(path.indexOf('/') + 1), bytes))
  if (archived !== commit) throw new Error(`the archive is of ${archived}, not the pinned ${commit}`)
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
