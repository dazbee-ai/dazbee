// The OpenType features a font file has: the tags in its GSUB and GPOS feature lists, read from its
// bytes, so the text tab offers only what the font can do and small caps can be drawn where it can't.

/** The features found by the bytes read, so a font's file is read once. */
const read = new WeakMap<Uint8Array, ReadonlySet<string>>()

/** The tags of the features in a TrueType or OpenType font file's GSUB and GPOS tables; none for bytes it can't read. */
export function fontFeatureTags(bytes: Uint8Array): ReadonlySet<string> {
  const known = read.get(bytes)
  if (known) return known
  const tags = new Set<string>()
  try {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const tables = view.getUint16(4)
    for (let i = 0; i < tables; i++) {
      const record = 12 + i * 16
      const tag = tagAt(view, record)
      if (tag !== 'GSUB' && tag !== 'GPOS') continue
      const table = view.getUint32(record + 8)
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
export function familyFeatures(fonts: readonly { family: string; bytes: Uint8Array }[]) {
  const families = new Map<string, Set<string>>()
  for (const { family, bytes } of fonts) {
    const tags = fontFeatureTags(bytes)
    const had = families.get(family)
    if (!had) families.set(family, new Set(tags))
    else for (const tag of had) if (!tags.has(tag)) had.delete(tag)
  }
  return families as ReadonlyMap<string, ReadonlySet<string>>
}

/** The four-character tag at `at`. */
function tagAt(view: DataView, at: number): string {
  return String.fromCharCode(view.getUint8(at), view.getUint8(at + 1), view.getUint8(at + 2), view.getUint8(at + 3))
}
