// A zip archive written for tests, as an artwork set's makers write their pack.
import { deflateRawSync } from 'node:zlib'

/** A zip archive of the files, each stored (method 0) or deflated (8), as a pack's makers write it. */
export function zipOf(files: { path: string; text: string; method: 0 | 8 }[]): Uint8Array {
  const locals: Buffer[] = []
  const entries: Buffer[] = []
  let offset = 0
  for (const { path, text, method } of files) {
    const name = Buffer.from(path)
    const raw = Buffer.from(text)
    const body = method === 8 ? deflateRawSync(raw) : raw
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(method, 8)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(name.length, 26)
    const entry = Buffer.alloc(46)
    entry.writeUInt32LE(0x02014b50, 0)
    entry.writeUInt16LE(method, 10)
    entry.writeUInt32LE(body.length, 20)
    entry.writeUInt32LE(raw.length, 24)
    entry.writeUInt16LE(name.length, 28)
    entry.writeUInt32LE(offset, 42)
    locals.push(local, name, body)
    entries.push(entry, name)
    offset += local.length + name.length + body.length
  }
  const directory = Buffer.concat(entries)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return new Uint8Array(Buffer.concat([...locals, directory, end]))
}
