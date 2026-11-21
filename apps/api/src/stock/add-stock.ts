// Saving a stock photo into a brand's asset library: its largest picture Dazbee may download, fetched through the
// safe fetch and recorded as a picture from a link is, named from its tags and tagged `stock`, `pixabay` and its
// photographer.
import type { Db } from '@dazbee/db'
import { AddAssetFromUrl, type AssetSummary, type StockPhotoId } from '@dazbee/schema'
import type { Storage } from '@dazbee/storage'

import { addAssetFromUrl } from '../assets/from-url.ts'
import { FetchRefused, type SafeFetchSettings } from '../fetch/safe-fetch.ts'
import { type StockDownload, type StockLibrary, StockRefused } from './pixabay.ts'

/** The tags every saved stock photo has, before its photographer's name. */
const SOURCE_TAGS = ['stock', 'pixabay']
/** The longest tag an asset has. */
const MAX_TAG_LENGTH = 40

/**
 * The asset of the stock photo of `id` in the brand's library: new, or the brand's asset of the same bytes with the
 * stock tags joining its own. A photo kept from an earlier request whose download is refused is looked up again
 * once, as its link may have lapsed. It throws `StockRefused` for an unknown id or a download that fails.
 */
export async function addStockPhoto(
  db: Db,
  storage: Storage,
  outside: SafeFetchSettings,
  stock: StockLibrary,
  workspaceId: string,
  brandId: string,
  id: StockPhotoId,
): Promise<AssetSummary> {
  let photo = await stock.photo(id)
  for (;;) {
    try {
      return await addAssetFromUrl(db, storage, outside, workspaceId, brandId, fromUrlOf(photo))
    } catch (error) {
      if (!(error instanceof FetchRefused)) throw error
      if (!photo.kept)
        throw new StockRefused(
          `Dazbee couldn’t download Pixabay’s photo ${id}; try again in a moment, or pick another photo`,
          502,
        )
      photo = await stock.photo(id, { fresh: true })
    }
  }
}

/** What adding `photo` from its link sends: its link, its name, and the stock tags with its photographer. */
function fromUrlOf(photo: StockDownload): AddAssetFromUrl {
  const photographer = photo.photographer.trim().slice(0, MAX_TAG_LENGTH)
  return AddAssetFromUrl.parse({
    url: photo.link,
    name: photo.name,
    tags: [...SOURCE_TAGS, ...(photographer ? [photographer] : [])],
  })
}
