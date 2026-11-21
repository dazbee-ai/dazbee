import type { CanvasKit, FontCollection, Image, TypefaceFontProvider } from '@dazbee/canvaskit'
import type { Variables } from '@dazbee/schema'

import type { LayerPictures } from './pictures.ts'
import { type FamilyFeatures, familyFeatures } from './text/font-features.ts'
import type { ParagraphCache } from './text/layout.ts'

/** An image's width and height in its own pixels. */
export interface ImageSize {
  width: number
  height: number
}

/** What drawing needs besides the scene: fonts registered from our own files and images decoded by CanvasKit. */
export interface Resources {
  fonts: FontCollection
  /** Families tried, in order, for characters a layer's own font lacks. */
  fallbackFamilies: string[]
  /**
   * The OpenType features each family has, those of every one of its files (`familyFeatures`):
   * small caps a family lacks are made up from capitals. Without it, every family lacks them.
   */
  familyFeatures?: FamilyFeatures
  images: ReadonlyMap<string, Image>
  /**
   * Each image's own size, where the image drawn is a smaller display copy of it, as the editor's
   * screen draws: placement, crops and tiles are in the image's own pixels. An image with no entry
   * is its own size.
   */
  imageSizes?: ReadonlyMap<string, ImageSize>
  /** Paragraphs kept between draws, for the editor's screen; without it each draw lays out its text and frees it. */
  paragraphs?: ParagraphCache
  /** Top-level layers recorded between draws, for the editor's screen; without it each draw draws every layer. */
  layers?: LayerPictures
  /** Set when drawing into a PDF or SVG: a text's outline pass is drawn as shapes, so the file holds the text once. */
  vector?: boolean
}

export interface ResourceBytes {
  /** Font files by family; the font's own name is ignored. Never system fonts (CLAUDE.md). */
  fonts: { family: string; bytes: Uint8Array }[]
  fallbackFamilies: string[]
  /** Encoded images (PNG, JPEG, WebP) by asset id, from originals or renditions we store. */
  images: Record<string, Uint8Array>
  /** The values bound properties take: the brand kit's colours and fonts by `brand:<token>` (#53). */
  variables?: Variables
}

export type ResourceCache = ReturnType<typeof resourceCache>

/** Registers fonts and decodes images with CanvasKit itself, so every runtime reads the same bytes the same way. */
export function makeResources(ck: CanvasKit, bytes: ResourceBytes): Resources & { delete(): void } {
  const cache = resourceCache(ck)
  try {
    return { ...cache.resources(bytes), delete: cache.delete }
  } catch (error) {
    cache.delete()
    throw error
  }
}

/**
 * Keeps registered fonts and decoded images between renders (#30). Each call to `resources` gives
 * what those bytes describe: images and fonts seen before are reused, new ones are decoded, and
 * any no longer named are freed. Bytes are told apart by their array object, so changed bytes must
 * come as a new array. Resources from an earlier call stay usable only until the next one.
 */
export function resourceCache(ck: CanvasKit) {
  // Decoded images by asset id, each with the bytes it was decoded from.
  const images = new Map<string, { bytes: Uint8Array; image: Image }>()
  // The registered fonts, with the list they were registered from.
  let fonts:
    | {
        list: ResourceBytes['fonts']
        provider: TypefaceFontProvider
        collection: FontCollection
        features: FamilyFeatures
      }
    | undefined

  function resources(bytes: ResourceBytes): Resources {
    const registered = fontsFor(bytes.fonts)
    return {
      fonts: registered.collection,
      fallbackFamilies: [...bytes.fallbackFamilies],
      familyFeatures: registered.features,
      images: imagesFor(bytes.images),
    }
  }

  function fontsFor(list: ResourceBytes['fonts']) {
    if (fonts && sameFonts(fonts.list, list)) return fonts
    // A provider can't drop a font, so a changed set of fonts is registered again from scratch, the
    // old set freed first: CanvasKit's memory then holds one set's files at a time, not two.
    freeFonts()
    const provider = ck.TypefaceFontProvider.Make()
    for (const font of list) provider.registerFont(font.bytes, font.family)
    const collection = ck.FontCollection.Make()
    collection.setDefaultFontManager(provider)
    fonts = { list: [...list], provider, collection, features: familyFeatures(list) }
    return fonts
  }

  function freeFonts() {
    fonts?.collection.delete()
    fonts?.provider.delete()
    fonts = undefined
  }

  function imagesFor(wanted: ResourceBytes['images']) {
    for (const [id, entry] of images) {
      if (wanted[id] !== entry.bytes) {
        entry.image.delete()
        images.delete(id)
      }
    }
    for (const [id, encoded] of Object.entries(wanted)) {
      if (images.has(id)) continue
      const image = ck.MakeImageFromEncoded(encoded)
      if (!image) throw new Error(`CanvasKit can't decode the image for asset "${id}"`)
      images.set(id, { bytes: encoded, image })
    }
    return new Map([...images].map(([id, { image }]) => [id, image]))
  }

  function destroy() {
    for (const { image } of images.values()) image.delete()
    images.clear()
    freeFonts()
  }

  return { resources, delete: destroy }
}

function sameFonts(a: ResourceBytes['fonts'], b: ResourceBytes['fonts']) {
  return a.length === b.length && a.every((f, i) => f.family === b[i]?.family && f.bytes === b[i]?.bytes)
}

/** An image's own size: the size it was drawn from when `image` is a display copy, else its own. */
export function imageSizeOf(resources: Pick<Resources, 'imageSizes'>, assetId: string, image: Image): ImageSize {
  return resources.imageSizes?.get(assetId) ?? { width: image.width(), height: image.height() }
}
