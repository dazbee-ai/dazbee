// The weight, width and slant CanvasKit reads a font file at, as Skia's FreeType scanner reads them
// (`SkFontScanner_FreeType::scanInstance` and `computeAxisValues` in src/ports/SkFontHost_FreeType.cpp,
// at the Skia commit packages/canvaskit/build/skia-commit names), from only the tables that say it.

/** Skia's slant: 0 upright, 1 italic, 2 oblique, as `SkFontStyle::Slant` numbers them. */
export type Slant = 0 | 1 | 2

/** A font file's style as CanvasKit reads it, which picks the face a text is drawn in. */
export interface FileStyle {
  /** 0 to 1000. */
  weight: number
  /** 1 (ultra-condensed) to 9 (ultra-expanded); 5 is normal. */
  width: number
  slant: Slant
}

/** Reads `length` bytes of a font file from `offset`; fewer where the file ends first. */
export type ReadBytes = (offset: number, length: number) => Promise<Uint8Array>

/** The `wdth` axis value of each OS/2 width class, 1 to 9, as Skia maps one to the other. */
const WIDTH_AXIS = [50, 62.5, 75, 87.5, 100, 112.5, 125, 150, 200] as const

/**
 * The style CanvasKit reads a TrueType or OpenType file at: the OS/2 table's weight and width
 * classes and its italic and oblique bits (the head table's bold and italic bits without one), then
 * a variable font's default weight, width and slant.
 */
export async function fileStyle(read: ReadBytes): Promise<FileStyle> {
  const tables = await tableDirectory(read)
  let weight = 400
  let width = 5
  let slant: Slant = 0
  const os2 = tables.get('OS/2')
  const os2Bytes = os2 && (await read(os2.offset, Math.min(os2.length, 64)))
  if (os2Bytes && os2Bytes.length >= 64) {
    const view = viewOf(os2Bytes)
    const selection = view.getUint16(62)
    // FreeType's italic flag: fsSelection's oblique or italic bit.
    if (selection & 0x201) slant = 1
    weight = view.getUint16(4)
    width = view.getUint16(6)
    if (selection & 0x200) slant = 2
  } else {
    const head = tables.get('head')
    const macStyle = head ? viewOf(await read(head.offset + 44, 2)).getUint16(0) : 0
    if (macStyle & 1) weight = 700
    if (macStyle & 2) slant = 1
  }
  const fvar = tables.get('fvar')
  const axes = fvar ? await variationAxes(read, fvar.offset, fvar.length) : []
  const wght = axes.find(
    (axis) => axis.tag === 'wght' && axis.max - axis.min > 5 && axis.max - axis.min <= 1000 && axis.max <= 1000,
  )
  const wdth = axes.find(
    (axis) => axis.tag === 'wdth' && axis.max - axis.min > 0 && axis.max - axis.min <= 500 && axis.max <= 500,
  )
  const slnt = axes.find((axis) => axis.tag === 'slnt')
  const ital = axes.find((axis) => axis.tag === 'ital')
  // The scanner: a variable font's default instance overrides the OS/2 table.
  if (wght) weight = Math.round(wght.value)
  if (wdth) width = widthClass(wdth.value)
  if (slnt && slnt.value < 0) slant = 2
  // `computeAxisValues`: the slant again, from the italic and slant axes.
  if (ital && ital.value !== 0) slant = 1
  else if (slnt && slnt.value !== 0) slant = 2
  else if (ital && slnt) slant = 0
  else if (ital && slant === 1) slant = 0
  else if (slnt && slant === 2) slant = 0
  return { weight: Math.min(1000, Math.max(0, weight)), width: Math.min(9, Math.max(1, width)), slant }
}

/** Where each table of the file is, by its tag. */
async function tableDirectory(read: ReadBytes): Promise<Map<string, { offset: number; length: number }>> {
  const header = viewOf(await read(0, 12))
  const count = header.getUint16(4)
  const records = viewOf(await read(12, count * 16))
  const tables = new Map<string, { offset: number; length: number }>()
  for (let i = 0; i < count; i++) {
    const at = i * 16
    tables.set(tagAt(records, at), { offset: records.getUint32(at + 8), length: records.getUint32(at + 12) })
  }
  return tables
}

function viewOf(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

/** A variable font's axes: each one's tag, range and default, the value its default instance has. */
async function variationAxes(read: ReadBytes, offset: number, length: number) {
  const view = viewOf(await read(offset, length))
  const axesAt = view.getUint16(4)
  const count = view.getUint16(8)
  const size = view.getUint16(10)
  return Array.from({ length: count }, (_, i) => {
    const at = axesAt + i * size
    const fixed = (from: number) => view.getInt32(at + from) / 65536
    return { tag: tagAt(view, at), min: fixed(4), value: fixed(8), max: fixed(12) }
  })
}

/** The OS/2 width class of a `wdth` axis value, interpolated between Skia's table and rounded. */
function widthClass(value: number): number {
  if (value <= WIDTH_AXIS[0]) return 1
  for (let i = 1; i < WIDTH_AXIS.length; i++) {
    const high = WIDTH_AXIS[i] ?? 0
    if (value <= high) {
      const low = WIDTH_AXIS[i - 1] ?? 0
      return Math.round(i + (value - low) / (high - low))
    }
  }
  return 9
}

function tagAt(view: DataView, at: number): string {
  return String.fromCharCode(view.getUint8(at), view.getUint8(at + 1), view.getUint8(at + 2), view.getUint8(at + 3))
}
