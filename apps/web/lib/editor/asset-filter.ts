// Which of the brand's images the asset library lists: the person's own, or, under Made with AI, the pictures the AI
// made, known by their tag.
import { AI_TAG, type AssetSummary } from '@dazbee/schema'

/** Whether an image is one the AI made. */
export function isAiAsset(asset: Pick<AssetSummary, 'tags'>): boolean {
  return asset.tags.includes(AI_TAG)
}

/** The images the library lists: the AI's under Made with AI (`madeWithAi`), else every other. */
export function libraryShows<A extends Pick<AssetSummary, 'tags'>>(assets: readonly A[], madeWithAi: boolean): A[] {
  return assets.filter((asset) => isAiAsset(asset) === madeWithAi)
}
