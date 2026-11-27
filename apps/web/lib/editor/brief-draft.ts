// What the brief box holds while it is closed: its words, pictures, size and speed, kept for each editor until they
// are sent or the editor ends, so closing the box and opening it again shows them as they were. A design left is a
// new editor, whose box starts empty. Edit brief fills it with a brief of the design, and a box open then shows it.
import type { AiBriefView, AiMode, AssetSummary, DesignAi } from '@dazbee/schema'

import { AI_SIZE_PRESETS } from './brief-box.ts'

/** A picture of the brief: uploading, uploaded as an asset of the brand, or not uploaded. */
export interface BriefPicture {
  key: string
  name: string
  /** The brand's asset it uploaded as; a brief's own pictures, taken by Edit brief, are known by their id alone. */
  asset?: Pick<AssetSummary, 'id'>
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
  /** Keeps `draft` for `holder` and tells a box open on it to show it, as Edit brief does. */
  fill(holder: object, draft: BriefDraft): void
  /** Calls back with the draft each time `holder`'s is filled. */
  onFill(holder: object, listener: (draft: BriefDraft) => void): () => void
}

/** The drafts of the brief boxes, each let go with its editor. */
export function briefDrafts(): BriefDrafts {
  const kept = new WeakMap<object, BriefDraft>()
  const fills = new WeakMap<object, Set<(draft: BriefDraft) => void>>()
  return {
    get: (holder, sizeId) => kept.get(holder) ?? { words: '', pictures: [], sizeId, mode: 'fast' },
    set: (holder, draft) => void kept.set(holder, draft),
    patchPicture: (holder, key, patch) => {
      const draft = kept.get(holder)
      if (!draft) return
      kept.set(holder, { ...draft, pictures: draft.pictures.map((p) => (p.key === key ? { ...p, ...patch } : p)) })
    },
    fill: (holder, draft) => {
      kept.set(holder, draft)
      for (const listener of [...(fills.get(holder) ?? [])]) listener(draft)
    },
    onFill: (holder, listener) => {
      const own = fills.get(holder) ?? new Set()
      fills.set(holder, own)
      own.add(listener)
      return () => own.delete(listener)
    },
  }
}

/**
 * The box's fields for brief `brief`, as Edit brief fills them: its words, its pictures named in order with `named`,
 * the size of the AI's list it was made at (the first when the list has it no more) and its speed.
 */
export function briefDraftOf(brief: AiBriefView, named: (n: number) => string): BriefDraft {
  const { width, height } = brief.size
  const size = AI_SIZE_PRESETS.find((p) => p.width === width && p.height === height) ?? AI_SIZE_PRESETS[0]
  return {
    words: brief.words,
    pictures: brief.pictureAssetIds.map((id, n) => ({ key: `${brief.id}/${id}`, name: named(n), asset: { id } })),
    sizeId: size?.id ?? '',
    mode: brief.mode,
  }
}

/** The brief whose section is `sectionId`, as `ai` last read; undefined for a section of no brief. */
export function briefOfSection(ai: DesignAi | null, sectionId: string): AiBriefView | undefined {
  return ai?.briefs.find((b) => b.sectionId === sectionId)
}

/** The app's brief drafts. */
export const BRIEF_DRAFTS = briefDrafts()
