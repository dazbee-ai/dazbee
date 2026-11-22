// Where the text matcher's fonts come from: the caller gives a source of a face's bytes by its key,
// so Node reads storage or a folder and a browser fetches the faces' permanent addresses. Words of
// the characters ads use load faces' match copies, any others their whole faces; a piece's faces are
// asked for all at once.
import { coversAll } from '@dazbee/fonts'

/** Gives the bytes of faces by key. */
export interface FontSource {
  /**
   * The bytes of the face that draws `key` (`family|weight|style`): its match copy when `copy` and it
   * has one, else the whole face; null when no face draws the key.
   */
  face(key: string, copy: boolean): Promise<Uint8Array | null>
}

/** The bytes of each face of `keys` for `words`, asked for at once, by key; null for a key no face draws. */
export async function loadFaces(
  source: FontSource,
  keys: readonly string[],
  words: string,
): Promise<Map<string, Uint8Array | null>> {
  const copy = coversAll(words)
  const unique = [...new Set(keys)]
  const bytes = await Promise.all(unique.map((key) => source.face(key, copy)))
  return new Map(unique.map((key, i) => [key, bytes[i] ?? null]))
}
