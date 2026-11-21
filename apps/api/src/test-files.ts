// Files the API tests upload and read: images, fonts, and the SHA-256 they are stored under; and
// Google families with google/fonts serving their files, as the font import reads them.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'

import type { GoogleFamily } from '@dazbee/fonts'
import { googleFileUrl } from '@dazbee/fonts/google'
import { FONT_FILES_DIR } from '@dazbee/fonts/node'

export const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

/** One of the font files we ship. */
export const fontFile = (file: string) => new Uint8Array(readFileSync(join(FONT_FILES_DIR, file)))

/** A Google family of the files given, each a name, its bytes, weight and style, in a folder of its own. */
export function googleFamily(
  family: string,
  files: { file: string; bytes: Uint8Array; weight: number; style?: 'normal' | 'italic' }[],
): GoogleFamily & { served: Map<string, Uint8Array> } {
  const path = `ofl/${family.toLowerCase().replace(/[^a-z0-9]/g, '')}`
  const faces = files.map(({ file, bytes, weight, style = 'normal' }) => ({
    file,
    blob: createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'),
    bytes: bytes.length,
    weight,
    style,
  }))
  return {
    family,
    category: 'sans-serif',
    rank: 1,
    licence: 'OFL',
    path,
    scripts: ['Latn'],
    axes: [],
    faces,
    served: new Map(files.map(({ file, bytes }) => [googleFileUrl({ path }, { file }), bytes])),
  }
}

/**
 * google/fonts as the import fetches it: the families' files at their URLs, each fetch counted in
 * `asked`, and a 404 for anything else.
 */
export function fakeGoogleFonts(...families: { served: Map<string, Uint8Array> }[]) {
  const asked: string[] = []
  const get = (async (input: string | URL | Request) => {
    const url = String(input)
    asked.push(url)
    const bytes = families.map((family) => family.served.get(url)).find(Boolean)
    return bytes ? new Response(bytes.slice()) : new Response('not found', { status: 404 })
  }) as typeof fetch
  return { get, asked }
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = (bytes: Uint8Array) => {
  let c = 0xffffffff
  for (const b of bytes) c = (crcTable[(c ^ b) & 0xff] ?? 0) ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** A real, decodable RGBA PNG whose colours come from `seed`, so different seeds give different bytes. */
export function png(width: number, height: number, seed: string): Uint8Array {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header.set([8, 6, 0, 0, 0], 8)
  const rows = Buffer.alloc(height * (1 + width * 4))
  for (let i = 0; i < rows.length; i++)
    rows[i] = i % (1 + width * 4) === 0 ? 0 : (seed.charCodeAt(i % seed.length) * (i + 7)) & 0xff
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  return new Uint8Array(
    Buffer.concat([
      signature,
      chunk('IHDR', header),
      chunk('IDAT', deflateSync(rows)),
      chunk('IEND', new Uint8Array()),
    ]),
  )
}

/** One PNG chunk: its length, type, data and CRC. */
function chunk(type: string, data: Uint8Array) {
  const out = Buffer.alloc(12 + data.length)
  out.writeUInt32BE(data.length, 0)
  out.write(type, 4, 'latin1')
  out.set(data, 8)
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length)
  return out
}
