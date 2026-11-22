// A bundled sticker's file in one of its styles: what a picture is (its PNG file sits in Dazbee's storage, not here),
// or a drawing's SVG text, as its set ships it.
import { readBundled } from './bundled.ts'
import { type PictureFile, stickerPicture } from './pictures.ts'
import { stickerFormat, type StickerSetId } from './sets.ts'

/** A sticker's file: a picture, which joins the brand's asset library, or a drawing, placed as layers. */
export type StickerFile = ({ format: 'picture' } & PictureFile) | { format: 'drawing'; svg: string }

/** Each style's drawings once read, by `set/style`. */
const drawings = new Map<string, Readonly<Record<string, string>>>()

/** The sticker `name` of `set` in `style`; throws when the set doesn't have it so. */
export function stickerFile(set: StickerSetId, name: string, style: string): StickerFile {
  const format = stickerFormat(set, style)
  if (format === 'picture') {
    const picture = stickerPicture(set, name, style)
    if (!picture) throw new Error(`${set} has no ${style} picture of ${name}`)
    const { path, sha256, byteSize, width, height } = picture
    return { format, path, sha256, byteSize, width, height }
  }
  const svg = format && drawingsOf(set, style)[name]
  if (!svg) throw new Error(`${set} has no ${style} drawing of ${name}`)
  return { format: 'drawing', svg }
}

/** A style's drawings, read from `sets/<set>/<style>.json` the first time. */
function drawingsOf(set: StickerSetId, style: string): Readonly<Record<string, string>> {
  const key = `${set}/${style}`
  const read = drawings.get(key)
  if (read) return read
  const parsed = readBundled(set, `${style}.json`) as Record<string, string>
  drawings.set(key, parsed)
  return parsed
}
