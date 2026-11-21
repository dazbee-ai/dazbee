// The tools for stock photos, which need no open design: search_stock searches Pixabay's free photos through the API,
// naming Pixabay as their source, and add_stock saves one into a brand's images, where place_asset places it.
import { z } from 'zod'

import { MAX_STOCK_QUERY, STOCK_PHOTO_MAX_SIDE, StockPhotoId, type StockResults, StockSearch } from '@dazbee/schema'

import { defineTool, type Tool, WithNotes } from './define-tool.ts'
import { BrandId, listedImage, viewOnly } from './workspace-tools.ts'

/** What a search's answer is followed by: where the photos come from, and what to do with one. */
const AFTER_SEARCH =
  'Photos from Pixabay (pixabay.com). add_stock saves one into a brand’s images by its id; then place it with place_asset. Look at a preview before you pick, when you can.'
/** What a saved photo's answer is followed by. */
const AFTER_ADD =
  'Saved from Pixabay into the brand’s images, tagged stock, pixabay and its photographer; place it with place_asset by its id.'

export const STOCK_TOOLS: Tool[] = [
  defineTool({
    name: 'search_stock',
    title: 'Search stock photos',
    description: `Searches Pixabay’s free stock photos for a photo that fits the ad when the brand has none of its own. Give English words for what the photo shows, such as “woman running beach”. It answers up to 20 photos, best first, each with its id for add_stock, a small preview link to look at, the size it is saved at (at most ${STOCK_PHOTO_MAX_SIDE} px a side), its photographer, its tags and its Pixabay page. When stock search is off on the server it says so: don’t try again, use add_image or the brand’s images. Needs an access that edits.`,
    readOnly: true,
    openWorld: true,
    input: z.object({
      query: StockSearch.shape.q.describe(
        `Words for what the photo shows, in English: at most ${MAX_STOCK_QUERY} characters`,
      ),
      orientation: StockSearch.shape.orientation.describe(
        'The shape of photo to keep to: landscape for wide frames, portrait for tall ones; any when left out',
      ),
      colour: StockSearch.shape.colour.describe('A colour the photo mostly has, such as one of the brand’s'),
    }),
    run: async ({ query, orientation, colour }, { api }) => {
      let found: StockResults
      try {
        found = await api.searchStock({
          q: query,
          ...(orientation === undefined ? {} : { orientation }),
          ...(colour === undefined ? {} : { colour }),
        })
      } catch (error) {
        throw viewOnly(error, 'search stock photos')
      }
      if (found.photos.length === 0) return `Pixabay has no photo for “${query}”; try fewer or other words, in English`
      return new WithNotes(found, [AFTER_SEARCH])
    },
  }),
  defineTool({
    name: 'add_stock',
    title: 'Save a stock photo',
    description:
      'Saves a photo search_stock found into a brand’s images by its id, named from its tags and tagged stock, pixabay and its photographer, and answers it as list_assets does, with the id to place it by. The same photo twice gives the same image. A download that fails comes back as a sentence: try again, or pick another photo. Needs an access that edits.',
    readOnly: false,
    openWorld: true,
    input: z.object({
      brand: BrandId,
      id: StockPhotoId.describe('The photo’s id, as search_stock gives it'),
    }),
    run: async ({ brand, id }, { api }) => {
      try {
        return new WithNotes(listedImage(await api.addStock(brand, id)), [AFTER_ADD])
      } catch (error) {
        throw viewOnly(error, 'save a stock photo')
      }
    },
  }),
]
