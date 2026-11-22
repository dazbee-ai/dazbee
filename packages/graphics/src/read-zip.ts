// Reading the files of a zip archive held in memory, as an artwork set's makers offer their pack: each file's path and
// bytes, from the archive's central directory, stored or deflated.
import { inflateRawSync } from 'node:zlib'

/** The signatures that open a zip's end record, a central directory entry and a file's local header. */
const END = 0x06054b50
const ENTRY = 0x02014b50
const LOCAL = 0x04034b50
/** How far from the end the end record may start: its 22 bytes and a comment of at most 65,535. */
const END_SEARCH = 22 + 0xffff
/** The most bytes one file, and all files, of an archive may unpack to, so a crafted archive can't fill the memory. */
const MAX_FILE_BYTES = 20_000_000
const MAX_TOTAL_BYTES = 200_000_000

/**
 * Each regular file of the zip archive, its path and bytes, in the central directory's order; throws when the archive
 * isn't a zip this can read (another compression than store or deflate, a file larger than MAX_FILE_BYTES, or files
 * larger than MAX_TOTAL_BYTES together).
 */
export function readZip(archive: Uint8Array): { path: string; bytes: Uint8Array }[] {
  const data = Buffer.from(archive.buffer, archive.byteOffset, archive.byteLength)
  const end = endRecord(data)
  const count = data.readUInt16LE(end + 10)
  let at = data.readUInt32LE(end + 16)
  const files: { path: string; bytes: Uint8Array }[] = []
  let total = 0
  for (let i = 0; i < count; i++) {
    if (data.readUInt32LE(at) !== ENTRY) throw new Error('the zip archive’s directory is broken')
    const method = data.readUInt16LE(at + 10)
    const packed = data.readUInt32LE(at + 20)
    const size = data.readUInt32LE(at + 24)
    const nameLength = data.readUInt16LE(at + 28)
    const extraLength = data.readUInt16LE(at + 30)
    const commentLength = data.readUInt16LE(at + 32)
    const local = data.readUInt32LE(at + 42)
    const path = data.subarray(at + 46, at + 46 + nameLength).toString('utf8')
    at += 46 + nameLength + extraLength + commentLength
    if (path.endsWith('/')) continue
    total += size
    if (size > MAX_FILE_BYTES) throw new Error(`${path} unpacks to more than ${MAX_FILE_BYTES} bytes`)
    if (total > MAX_TOTAL_BYTES) throw new Error(`the archive unpacks to more than ${MAX_TOTAL_BYTES} bytes`)
    if (data.readUInt32LE(local) !== LOCAL) throw new Error(`the zip archive’s ${path} is broken`)
    const start = local + 30 + data.readUInt16LE(local + 26) + data.readUInt16LE(local + 28)
    const body = data.subarray(start, start + packed)
    if (method === 0 || size === 0) files.push({ path, bytes: new Uint8Array(body.subarray(0, size)) })
    else if (method === 8) files.push({ path, bytes: new Uint8Array(inflateRawSync(body, { maxOutputLength: size })) })
    else throw new Error(`${path} is packed with method ${method}, which isn’t read`)
  }
  return files
}

/** Where the archive's end record starts; throws when it has none. */
function endRecord(data: Buffer): number {
  for (let at = data.length - 22; at >= Math.max(0, data.length - END_SEARCH); at--)
    if (data.readUInt32LE(at) === END) return at
  throw new Error('the file is not a zip archive')
}
