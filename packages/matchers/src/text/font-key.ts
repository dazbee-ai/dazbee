// A font fingerprint's key, `family|weight|style` (`Roboto|700|normal`), and the face of the font catalog it names:
// the face of that family and style whose weight is the key's, or whose range of weights covers it. A text layer
// matched to the key is set in that face at the key's weight.
import type { CatalogFace, FontStyle } from '@dazbee/fonts'

/** What a key names: a family at one weight, a hundred, in one style. */
export interface FontKey {
  family: string
  weight: number
  style: FontStyle
}

const KEY = /^(.+)\|([1-9]00)\|(normal|italic)$/

/** The key's family, weight and style; null for text that is no key. */
export function parseFontKey(key: string): FontKey | null {
  const parts = KEY.exec(key)
  if (!parts?.[1] || !parts[2] || !parts[3]) return null
  return { family: parts[1], weight: Number(parts[2]), style: parts[3] as FontStyle }
}

/**
 * The face of `faces`, a family's faces in the catalog, that draws `key`, and the weight to set it at; null when
 * the family has no face of that style whose weight is the key's or whose range covers it. A face of exactly the
 * key's weight comes before a range that covers it.
 */
export function faceOfKey<F extends CatalogFace>(
  key: FontKey,
  faces: readonly F[],
): { face: F; weight: number } | null {
  const ofStyle = faces.filter((face) => face.family === key.family && face.style === key.style)
  const face =
    ofStyle.find((f) => !f.weights && f.weight === key.weight) ??
    ofStyle.find((f) => f.weights && f.weights.min <= key.weight && key.weight <= f.weights.max)
  return face ? { face, weight: key.weight } : null
}
