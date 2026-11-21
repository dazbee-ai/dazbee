// The OpenType features a font file has: the tags in its GSUB and GPOS feature lists, read from its
// bytes, so the text tab offers only what the font can do and small caps can be drawn where it can't.
// Also its superscript and subscript size and offset (its OS/2 table), which superscripts and
// subscripts it has no glyphs for are made up with.

/** The OpenType features each family has, by family. */
export type FamilyFeatures = ReadonlyMap<string, ReadonlySet<string>>

/**
 * A font's superscript or subscript: the share of the size its letters are drawn at, and how far
 * their baseline moves as a share of the em, up for a superscript and down for a subscript.
 */
export interface ScriptPlacement {
  scale: number
  shift: number
}

/** A font's superscript and subscript placements. */
export interface Scripts {
  superscript: ScriptPlacement
  subscript: ScriptPlacement
}

/** A font file's superscript and subscript placements, with the weight and slant of the file. */
export interface FontScripts extends Scripts {
  weight: number
  italic: boolean
}

/** The superscripts and subscripts of each family's files, by family. */
export type FamilyScripts = ReadonlyMap<string, readonly FontScripts[]>

/** What common fonts carry, taken where a font leaves a value at zero: 65 % of the size, raised 35 % or lowered 14 % of an em. */
export const USUAL_SCRIPTS: Scripts = {
  superscript: { scale: 0.65, shift: 0.35 },
  subscript: { scale: 0.65, shift: 0.14 },
}

/** The features found by the bytes read, so a font's file is read once. */
const read = new WeakMap<Uint8Array, ReadonlySet<string>>()

/** The tags of the features in a TrueType or OpenType font file's GSUB and GPOS tables; none for bytes it can't read. */
export function fontFeatureTags(bytes: Uint8Array): ReadonlySet<string> {
  const known = read.get(bytes)
  if (known) return known
  const tags = new Set<string>()
  try {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    for (const tag of ['GSUB', 'GPOS']) {
      const table = tableAt(view, tag)
      if (table === null) continue
      const list = table + view.getUint16(table + 6)
      const count = view.getUint16(list)
      for (let f = 0; f < count; f++) tags.add(tagAt(view, list + 2 + f * 6))
    }
  } catch {
    // Bytes that end early hold the features read so far.
  }
  read.set(bytes, tags)
  return tags
}

/**
 * The features each family has, by family: those every one of its files has, so a feature is
 * counted on only where each weight and style of the family draws it.
 */
export function familyFeatures(fonts: readonly { family: string; bytes: Uint8Array }[]): FamilyFeatures {
  const families = new Map<string, Set<string>>()
  for (const { family, bytes } of fonts) {
    const tags = fontFeatureTags(bytes)
    const had = families.get(family)
    if (!had) families.set(family, new Set(tags))
    else for (const tag of had) if (!tags.has(tag)) had.delete(tag)
  }
  return families
}

/**
 * A font file's superscript and subscript size and offset, from its OS/2 table over its em (head),
 * with its weight and whether it is italic. A size or offset left at zero, or bytes it can't read,
 * take the usual values (`USUAL_SCRIPTS`).
 */
export function fontScripts(bytes: Uint8Array): FontScripts {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  try {
    const os2 = tableAt(view, 'OS/2')
    const head = tableAt(view, 'head')
    const em = head === null ? 0 : view.getUint16(head + 18)
    if (os2 === null || em === 0) throw new RangeError('no OS/2 or head table')
    const placement = (size: number, offset: number, usual: ScriptPlacement): ScriptPlacement => ({
      scale: size > 0 ? size / em : usual.scale,
      shift: offset !== 0 ? offset / em : usual.shift,
    })
    return {
      weight: view.getUint16(os2 + 4),
      italic: (view.getUint16(os2 + 62) & 1) === 1,
      subscript: placement(view.getInt16(os2 + 12), view.getInt16(os2 + 16), USUAL_SCRIPTS.subscript),
      superscript: placement(view.getInt16(os2 + 20), view.getInt16(os2 + 24), USUAL_SCRIPTS.superscript),
    }
  } catch {
    return { weight: 400, italic: false, ...USUAL_SCRIPTS }
  }
}

/** The superscripts and subscripts of each family's files, by family. */
export function familyScripts(fonts: readonly { family: string; bytes: Uint8Array }[]): FamilyScripts {
  const families = new Map<string, FontScripts[]>()
  for (const { family, bytes } of fonts) {
    const files = families.get(family) ?? []
    files.push(fontScripts(bytes))
    families.set(family, files)
  }
  return families
}

/**
 * The superscript and subscript placements a family draws at a weight and slant: those of its file
 * in that slant (else any) nearest the weight. The usual ones for a family with no files.
 */
export function scriptsOf(scripts: FamilyScripts | undefined, family: string, weight: number, italic: boolean): Scripts {
  const files = scripts?.get(family) ?? []
  const slanted = files.filter((file) => file.italic === italic)
  const nearest = (slanted.length > 0 ? slanted : files).reduce<FontScripts | null>(
    (best, file) => (best && Math.abs(best.weight - weight) <= Math.abs(file.weight - weight) ? best : file),
    null,
  )
  return nearest ? { superscript: nearest.superscript, subscript: nearest.subscript } : USUAL_SCRIPTS
}

/** Where the table with this tag starts in a font file, or null when the file has none. */
function tableAt(view: DataView, tag: string): number | null {
  const tables = view.getUint16(4)
  for (let i = 0; i < tables; i++) {
    const record = 12 + i * 16
    if (tagAt(view, record) === tag) return view.getUint32(record + 8)
  }
  return null
}

/** The four-character tag at `at`. */
function tagAt(view: DataView, at: number): string {
  return String.fromCharCode(view.getUint8(at), view.getUint8(at + 1), view.getUint8(at + 2), view.getUint8(at + 3))
}
