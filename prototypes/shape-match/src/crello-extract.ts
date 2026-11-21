// PROTOTYPE. Picks Crello test-split elements for the outside benchmark: a fixed sample, chosen by a
// hash of the template id and element index (never by content), of shape elements (SvgElement),
// coloured backgrounds and image elements, each written as its own PNG with its type and palette.
// Reads data/crello/test-*.parquet; writes data/crello/blocks/*.png and data/crello/index.json.
import { mkdirSync, openAsBlob, readdirSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

import { parquetMetadataAsync, parquetReadObjects } from 'hyparquet'

const TYPES: Record<number, string> = { 0: 'shape element', 2: 'image element', 3: 'coloured background' }
const WANT: Record<string, number> = { 'shape element': 400, 'coloured background': 200, 'image element': 200 }
const DIR = 'data/crello'

interface Pick {
  key: string
  type: string
  palette: string[]
  file: string
  rank: string
}
const found: Record<string, Pick[]> = { 'shape element': [], 'coloured background': [], 'image element': [] }
const bytes: Map<string, Uint8Array> = new Map()

mkdirSync(`${DIR}/blocks`, { recursive: true })
for (const name of readdirSync(DIR)
  .filter((f) => f.endsWith('.parquet'))
  .sort()) {
  const blob = await openAsBlob(`${DIR}/${name}`)
  const file = { byteLength: blob.size, slice: async (s: number, e?: number) => await blob.slice(s, e).arrayBuffer() }
  const metadata = await parquetMetadataAsync(file)
  let start = 0
  for (const g of metadata.row_groups) {
    const end = start + Number(g.num_rows)
    const rows = (await parquetReadObjects({
      file,
      metadata,
      rowStart: start,
      rowEnd: end,
      columns: ['id', 'type', 'color', 'image'],
      utf8: false,
    })) as {
      id: Uint8Array
      type: (number | bigint)[]
      color: (Uint8Array | string)[][]
      image: { bytes: Uint8Array }[]
    }[]
    for (const r of rows) {
      const id = Buffer.from(r.id).toString('utf8')
      r.type.forEach((t, i) => {
        const type = TYPES[Number(t)]
        if (!type) return
        const key = `${id}_${i}`
        const rank = createHash('sha256').update(key).digest('hex')
        const palette = (r.color[i] ?? []).map((c) => (typeof c === 'string' ? c : Buffer.from(c).toString('utf8')))
        found[type]!.push({ key, type, palette, file: `blocks/${key}.png`, rank })
        // Keep only the bytes of elements that can still be in the sample.
        bytes.set(key, r.image[i]!.bytes)
      })
      for (const [type, list] of Object.entries(found)) {
        list.sort((a, b) => (a.rank < b.rank ? -1 : 1))
        for (const dropped of list.splice(WANT[type]!)) bytes.delete(dropped.key)
      }
    }
    start = end
  }
  console.log(
    name,
    Object.entries(found)
      .map(([k, v]) => `${k} ${v.length}`)
      .join(', '),
  )
}
const index = Object.values(found).flat()
for (const p of index) writeFileSync(`${DIR}/${p.file}`, bytes.get(p.key)!)
writeFileSync(
  `${DIR}/index.json`,
  JSON.stringify(
    index.map(({ rank: _r, ...rest }) => rest),
    null,
    1,
  ),
)
console.log('picked', index.length)
