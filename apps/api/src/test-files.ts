// Files the API tests upload and read: images, SVG files too slow or too big to draw, fonts, and the SHA-256 they are stored under; and
// Google families with google/fonts serving their files, as the font import reads them.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { constants, deflateRawSync, deflateSync } from 'node:zlib'

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

/**
 * An SVG file within the reader's limits whose drawing needs more memory than its thread may take:
 * one 7,500 × 7,500 picture, 225 MB once decoded, in 0.4 MB.
 */
export function bigPictureSvg(): string {
  const href = `data:image/png;base64,${Buffer.from(clearPng(7500, 7500)).toString('base64')}`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><image href="${href}" width="100" height="100"/></svg>`
}

/**
 * An SVG file within the reader's limits that takes seconds to draw: two filled paths of `points`
 * points each zigzagging across it, 250,000 unless given.
 */
export function slowPathsSvg(points = 250_000): string {
  const zigzag = (from: number) =>
    Array.from({ length: points - 1 }, (_, i) => `L${(from + i) % 1000} ${((from + i) * 7) % 1000}`).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1000"><path d="M0 0${zigzag(1)}"/><path d="M0 0${zigzag(500)}"/></svg>`
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

/**
 * A see-through PNG of any size, made without holding its pixels: each row of zeros is compressed
 * once, as a block of its own that ends on a whole byte, and repeated.
 */
function clearPng(width: number, height: number): Uint8Array {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header.set([8, 6, 0, 0, 0], 8)
  const row = deflateRawSync(new Uint8Array(1 + width * 4), { finishFlush: constants.Z_SYNC_FLUSH })
  // Adler-32 of that many zeros: its sum stays 1, and the sum of sums counts the bytes.
  const checksum = Buffer.alloc(4)
  checksum.writeUInt32BE((((height * (1 + width * 4)) % 65_521) * 65_536 + 1) >>> 0)
  const stream = Buffer.concat([
    Buffer.from([0x78, 0x01]),
    ...Array.from({ length: height }, () => row),
    // An empty last block.
    Buffer.from([0x03, 0x00]),
    checksum,
  ])
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  return new Uint8Array(
    Buffer.concat([signature, chunk('IHDR', header), chunk('IDAT', stream), chunk('IEND', new Uint8Array())]),
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
