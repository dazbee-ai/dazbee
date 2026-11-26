// What the Make an image box in Assets shows of the person's own image jobs on the brand, and what its button's
// tooltip says an image takes.
import type { AiEstimate, ImageRatio, MyAiJob } from '@dazbee/schema'

import { format, type Messages } from '@/lib/i18n/index.ts'

/** An image job as the box shows it: still working, or one that didn't come out. */
export interface ImageTile {
  job: string
  words: string
  ratio: ImageRatio
  state: 'working' | 'failed'
}

/** Each ratio drawn as a small outline, in pixels. */
export const RATIO_SHAPES: Record<ImageRatio, { width: number; height: number }> = {
  square: { width: 12, height: 12 },
  wide: { width: 15, height: 10 },
  tall: { width: 10, height: 15 },
}

/**
 * The tiles of the person's image jobs, given newest first: each one still working, and each that didn't come out
 * and wasn't asked for again since with the same words and ratio. An image that was made shows in the library, with
 * no tile.
 */
export function imageTiles(jobs: MyAiJob[]): ImageTile[] {
  const tiles: ImageTile[] = []
  const asked = new Set<string>()
  for (const { id, state, image } of jobs) {
    if (!image) continue
    const again = `${image.ratio}\n${image.words}`
    const working = state === 'waiting' || state === 'running'
    if (working || (state === 'failed' && !asked.has(again))) {
      tiles.push({ job: id, words: image.words, ratio: image.ratio, state: working ? 'working' : 'failed' })
    }
    asked.add(again)
  }
  return tiles
}

/** The images the person's image jobs made, by asset id. */
export function madeImages(jobs: MyAiJob[]): string[] {
  return jobs.flatMap((job) => (job.state === 'done' && job.image?.assetId ? [job.image.assetId] : []))
}

/**
 * The tooltip of Make an image: its share of the workspace's AI and about how long it takes; the time alone for a
 * workspace with no allowance; the button's name while neither is known.
 */
export function estimateWords(estimate: AiEstimate | null, t: Messages['editor']['makeImage']): string {
  if (!estimate) return t.make
  const { share, seconds } = estimate
  if (share === null) return format(t.estimateTime, { seconds })
  return format(t.estimate, {
    share: share === 'under-1' ? t.shareUnder : format(t.share, { percent: share }),
    seconds,
  })
}
