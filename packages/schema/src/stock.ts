// Stock photos: a search of a stock library (Pixabay for now), the photos it finds, and saving one into a brand's
// asset library by its id.
import { z } from 'zod'

/** The library stock photos come from, which every answer of a search names. */
export const STOCK_SOURCE = 'Pixabay'
/** The longest search a stock library takes, in characters (Pixabay's limit). */
export const MAX_STOCK_QUERY = 100
/** The longest side of a stock photo saved into a brand's library, in pixels. */
export const STOCK_PHOTO_MAX_SIDE = 1280

/** The shapes of photo a search may keep to. */
export const STOCK_ORIENTATIONS = ['any', 'landscape', 'portrait'] as const
/** The colours a search may keep to, as Pixabay names them. */
export const STOCK_COLOURS = [
  'grayscale',
  'transparent',
  'red',
  'orange',
  'yellow',
  'green',
  'turquoise',
  'blue',
  'lilac',
  'pink',
  'white',
  'gray',
  'black',
  'brown',
] as const

/** A search for stock photos: its words, and the shape and colour of photo to keep to. */
export const StockSearch = z.object({
  q: z.string().trim().min(1).max(MAX_STOCK_QUERY),
  orientation: z.enum(STOCK_ORIENTATIONS).optional(),
  colour: z.enum(STOCK_COLOURS).optional(),
})
export type StockSearch = z.infer<typeof StockSearch>

/** A stock library's id of one photo. */
export const StockPhotoId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
export type StockPhotoId = z.infer<typeof StockPhotoId>

/**
 * A photo a search found: its id, a small preview to look at, the size it is saved at, who took it, the words it
 * is found by, and its page on the library's site.
 */
export const StockPhoto = z.object({
  id: StockPhotoId,
  preview: z.url(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  photographer: z.string(),
  tags: z.array(z.string()),
  page: z.url(),
})
export type StockPhoto = z.infer<typeof StockPhoto>

/** What a search answers: the library the photos come from, and the photos, best first. */
export const StockResults = z.object({ source: z.literal(STOCK_SOURCE), photos: z.array(StockPhoto) })
export type StockResults = z.infer<typeof StockResults>

/** Saves the stock photo of `id` into a brand's asset library. */
export const AddStockPhoto = z.object({ id: StockPhotoId })
export type AddStockPhoto = z.infer<typeof AddStockPhoto>
