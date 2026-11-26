// What the brief box holds while it is closed: its words, pictures, size and speed, kept for each editor until they
// are sent or the editor ends, so closing the box and opening it again shows them as they were. A design left is a
// new editor, whose box starts empty.
import type { AiMode, AssetSummary } from '@dazbee/schema'

/** A picture of the brief: uploading, uploaded as an asset of the brand, or not uploaded. */
export interface BriefPicture {
  key: string
  name: string
  asset?: AssetSummary
  failed?: boolean
}

/** The brief box's fields. */
export interface BriefDraft {
  words: string
  pictures: BriefPicture[]
  /** The picked size, by its preset's id. */
  sizeId: string
  mode: AiMode
}

/** The drafts of the brief boxes, one per editor. */
export interface BriefDrafts {
  /** The draft kept for `holder`, or a new empty one at `sizeId` and Fast. */
  get(holder: object, sizeId: string): BriefDraft
  /** Keeps `draft` for `holder`. */
  set(holder: object, draft: BriefDraft): void
  /** Changes picture `key` of `holder`'s draft, as its upload ends after the box closed. */
  patchPicture(holder: object, key: string, patch: Partial<BriefPicture>): void
}

/** The drafts of the brief boxes, each let go with its editor. */
export function briefDrafts(): BriefDrafts {
  const kept = new WeakMap<object, BriefDraft>()
  return {
    get: (holder, sizeId) => kept.get(holder) ?? { words: '', pictures: [], sizeId, mode: 'fast' },
    set: (holder, draft) => void kept.set(holder, draft),
    patchPicture: (holder, key, patch) => {
      const draft = kept.get(holder)
      if (!draft) return
      kept.set(holder, { ...draft, pictures: draft.pictures.map((p) => (p.key === key ? { ...p, ...patch } : p)) })
    },
  }
}

/** The app's brief drafts. */
export const BRIEF_DRAFTS = briefDrafts()
