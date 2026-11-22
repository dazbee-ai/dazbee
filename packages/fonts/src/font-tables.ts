// A font file's tables read in place: its table directory and the code points its character map gives a glyph.

/** How many code points Unicode has: the most a character map can give a glyph. */
const CODE_POINTS = 0x110000

export const tag = (view: DataView, at: number) =>
  String.fromCharCode(view.getUint8(at), view.getUint8(at + 1), view.getUint8(at + 2), view.getUint8(at + 3))

/**
 * The font's tables, each with where its record is in the directory and where its bytes are, or
 * null when a record or a table runs past the end of the file.
 */
export function tableDirectory(view: DataView): { record: number; tag: string; at: number; length: number }[] | null {
  const tables = []
  for (let i = 0; i < view.getUint16(4); i++) {
    const record = 12 + i * 16
    if (record + 16 > view.byteLength) return null
    const at = view.getUint32(record + 8)
    const length = view.getUint32(record + 12)
    if (at + length > view.byteLength) return null
    tables.push({ record, tag: tag(view, record), at, length })
  }
  return tables
}

/**
 * The code points the character map gives a glyph: those of its Unicode subtable of format 12
 * (every plane), or else of format 4 (the Basic Multilingual Plane). A subtable that runs past the
 * table gives none; one that visits more code points than there are stops there.
 */
export function characterMap(view: DataView, at: number, length: number): number[] {
  const end = at + length
  const tables = new Map<number, number>()
  if (length < 4) return []
  for (let i = 0; i < view.getUint16(at + 2); i++) {
    const record = at + 4 + i * 8
    if (record + 8 > end) break
    const [platform, encoding] = [view.getUint16(record), view.getUint16(record + 2)]
    if (platform !== 0 && !(platform === 3 && (encoding === 1 || encoding === 10))) continue
    const table = at + view.getUint32(record + 4)
    if (table + 2 <= end && !tables.has(view.getUint16(table))) tables.set(view.getUint16(table), table)
  }
  const twelve = tables.get(12)
  const four = tables.get(4)
  return twelve !== undefined ? format12(view, twelve, end) : four !== undefined ? format4(view, four, end) : []
}

/** The code points a format 12 subtable maps to a glyph: runs of code points to runs of glyph IDs. */
function format12(view: DataView, table: number, end: number): number[] {
  const points: number[] = []
  let visited = 0
  if (table + 16 > end) return points
  const groups = view.getUint32(table + 12)
  if (table + 16 + groups * 12 > end) return points
  for (let g = 0; g < groups; g++) {
    const group = table + 16 + g * 12
    const [first, last, glyph] = [view.getUint32(group), view.getUint32(group + 4), view.getUint32(group + 8)]
    for (let point = first; point <= last && point < CODE_POINTS; point++) {
      if (++visited > CODE_POINTS) return points
      if (glyph + point - first !== 0) points.push(point)
    }
  }
  return points
}

/** The code points a format 4 subtable maps to a glyph: segments of the BMP, each with a delta or glyph IDs. */
function format4(view: DataView, table: number, end: number): number[] {
  const points: number[] = []
  let visited = 0
  if (table + 14 > end) return points
  const segments = view.getUint16(table + 6) >> 1
  const ends = table + 14
  const starts = ends + segments * 2 + 2
  const deltas = starts + segments * 2
  const offsets = deltas + segments * 2
  if (offsets + segments * 2 > end) return points
  for (let s = 0; s < segments; s++) {
    const [first, last] = [view.getUint16(starts + s * 2), view.getUint16(ends + s * 2)]
    const delta = view.getUint16(deltas + s * 2)
    const offset = view.getUint16(offsets + s * 2)
    for (let point = first; point <= last && point < 0xffff; point++) {
      if (++visited > CODE_POINTS) return points
      const at = offsets + s * 2 + offset + (point - first) * 2
      const glyph = offset === 0 ? point : at + 2 <= end ? view.getUint16(at) : 0
      if (glyph !== 0 && (glyph + delta) % 0x10000 !== 0) points.push(point)
    }
  }
  return points
}
