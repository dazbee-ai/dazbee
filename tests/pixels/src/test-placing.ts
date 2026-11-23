// Resources that draw every text letter by letter, for checking the placed drawing against the
// paragraphs' own.
import type { CanvasKit } from '@dazbee/canvaskit'
import {
  inPlace,
  paragraphCache,
  type PlaceGlyph,
  placeLetters,
  type ResourceBytes,
  type ResourceCache,
  resourceCache,
} from '@dazbee/renderer'

/** Resources whose texts are all placed with `place`, so they draw letter by letter. */
export function placing(ck: CanvasKit, place: PlaceGlyph = inPlace): ResourceCache {
  const cache = resourceCache(ck)
  const paragraphs = paragraphCache()
  return {
    ...cache,
    resources: (b: ResourceBytes) => ({
      ...cache.resources(b),
      paragraphs: {
        layout(...args: Parameters<typeof paragraphs.layout>) {
          const laid = paragraphs.layout(...args)
          laid.placed ??= placeLetters(ck, laid, place)
          return laid
        },
        delete: paragraphs.delete,
      },
    }),
    delete() {
      paragraphs.delete()
      cache.delete()
    },
  }
}
