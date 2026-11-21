'use client'

// The brand's kit as the app shows and saves it, shared by the editor's Brand flyout and Page card
// and by the brand home's brief and Brand kit page: a change made in one shows in the others at
// once. Fetched once per brand, and again each time the flyout or the page opens.
//
// A change shows at once and is saved a moment later, one save of a brand at a time. Each save says
// which stored kit it was made from (`basedOn`), so a kit saved in another tab or by another member
// since is never overwritten: the API refuses the save, and the tab shows the newer kit and says
// which of its changes weren't saved, saving none of those made on the older kit. A kit that can't
// be read shows as unreadable, never as the empty kit, so it can't be saved over.
import { useCallback, useEffect, useSyncExternalStore } from 'react'

import { type BrandKit, StoredBrandKit } from '@dazbee/schema'

import { brandPath, RouteError } from '@/lib/brand-routes.ts'

import { changedParts, type KitPart } from './kit-changes.ts'

/** What keeps the kit from being saved as it shows. */
export type KitTrouble =
  /** A save was refused, since the kit was saved elsewhere since: the newer kit shows, and `unsaved` weren't kept. */
  | { kind: 'changed'; unsaved: KitPart[] }
  /** A save failed, for the reason given; the kit shows the change. */
  | { kind: 'failed'; reason: string }
  /** The kit couldn't be fetched or read: there is no kit to show or change, and `unsaved` weren't kept. */
  | { kind: 'unreadable'; unsaved: KitPart[] }

/** A change waiting to be saved, and the timer that saves it. */
interface Waiting {
  workspaceId: string
  kit: BrandKit
  timer: ReturnType<typeof setTimeout>
}

/** How long a run of changes (a colour picker's drag) waits before it is saved. */
export const SAVE_DELAY_MS = 400

/** The kit each brand shows. */
const kits = new Map<string, BrandKit>()
/** The stored kit each shown kit was made from: its `updatedAt` goes with the next save as `basedOn`. */
const storedKits = new Map<string, StoredBrandKit>()
/** What keeps each brand's kit from being saved, when anything does. */
const troubles = new Map<string, KitTrouble>()
/** The change each brand has waiting to be saved. */
const waiting = new Map<string, Waiting>()
/** The save of each brand on its way. */
const sending = new Map<string, Promise<void>>()
/** Counts each brand's changes and saves, so a fetch out meanwhile brings back nothing older. */
const revisions = new Map<string, number>()
const listeners = new Map<string, Set<() => void>>()

/** The kit the brand shows, or null while there is none: not fetched yet, or unreadable. */
export function shownKit(brandId: string): BrandKit | null {
  return kits.get(brandId) ?? null
}

/** What keeps the brand's kit from being saved as it shows, or null. */
export function kitTrouble(brandId: string): KitTrouble | null {
  return troubles.get(brandId) ?? null
}

/** Shows a change to the kit everywhere it is drawn at once, and saves it a moment later. */
export function changeKit(workspaceId: string, brandId: string, kit: BrandKit) {
  const before = waiting.get(brandId)
  if (before) clearTimeout(before.timer)
  waiting.set(brandId, { workspaceId, kit, timer: setTimeout(() => send(brandId), SAVE_DELAY_MS) })
  kits.set(brandId, kit)
  revise(brandId)
}

/** Saves the change waiting to be saved now, as a form closing does. */
export function saveWaitingKit(brandId: string) {
  const change = waiting.get(brandId)
  if (!change) return
  clearTimeout(change.timer)
  send(brandId)
}

/** Puts away the word that a save was refused, once the person has read it. */
export function dismissKitTrouble(brandId: string) {
  if (troubles.get(brandId)?.kind !== 'changed') return
  troubles.delete(brandId)
  revise(brandId)
}

/**
 * Fetches the kit. A change made or saved while it is out, one still waiting to be saved, or one
 * whose save failed, is kept over it. When it can't be fetched or read and the brand shows no kit,
 * the kit is unreadable.
 */
export async function loadKit(workspaceId: string, brandId: string) {
  await sending.get(brandId)
  const before = revisions.get(brandId)
  const fetched = await fetchKit(workspaceId, brandId)
  if (revisions.get(brandId) !== before || waiting.has(brandId) || sending.has(brandId)) return
  // A change whose save failed shows until the next change saves it.
  if (troubles.get(brandId)?.kind === 'failed') return
  if (fetched) show(brandId, fetched)
  else if (!kits.has(brandId)) showUnreadable(brandId, [])
}

/**
 * The brand's kit, or null while there is none. A kit the page already has (`first`) is taken as
 * the brand's until a change or a fetch replaces it, so it is not fetched again.
 */
export function useBrandKit(workspaceId: string, brandId: string, first?: StoredBrandKit | null) {
  if (first && !kits.has(brandId) && !troubles.has(brandId)) {
    kits.set(brandId, kitOf(first))
    storedKits.set(brandId, first)
  }
  const kit = useSyncExternalStore(
    useSubscribe(brandId),
    () => shownKit(brandId),
    () => null,
  )
  useEffect(() => {
    if (!kits.has(brandId) && !troubles.has(brandId)) void loadKit(workspaceId, brandId)
  }, [workspaceId, brandId])
  return kit
}

/** What keeps the brand's kit from being saved as it shows, or null. */
export function useKitTrouble(brandId: string) {
  return useSyncExternalStore(
    useSubscribe(brandId),
    () => kitTrouble(brandId),
    () => null,
  )
}

/** Sends the change waiting to be saved, once the save on its way ends; then the next one. */
function send(brandId: string) {
  const change = waiting.get(brandId)
  if (!change || sending.has(brandId)) return
  waiting.delete(brandId)
  const saved = save(change.workspaceId, brandId, change.kit).finally(() => {
    sending.delete(brandId)
    send(brandId)
  })
  sending.set(brandId, saved)
}

/** Counts a change to the brand's kit and tells everything showing it. */
function revise(brandId: string) {
  revisions.set(brandId, (revisions.get(brandId) ?? 0) + 1)
  for (const listener of listeners.get(brandId) ?? []) listener()
}

/** The kit as stored, or null when it can't be fetched or read. */
async function fetchKit(workspaceId: string, brandId: string) {
  const response = await fetch(brandPath(workspaceId, brandId, 'kit', 'data')).catch(() => null)
  if (!response?.ok) return null
  return StoredBrandKit.safeParse(await response.json().catch(() => null)).data ?? null
}

/** The kit a stored kit holds, without when it was saved. */
function kitOf({ colors, fonts, logoAssetId, voice, textStyles }: StoredBrandKit): BrandKit {
  return { colors, fonts, logoAssetId, voice, textStyles }
}

/** Shows the kit as stored, and saves the next change as made from it. */
function show(brandId: string, kit: StoredBrandKit) {
  kits.set(brandId, kitOf(kit))
  storedKits.set(brandId, kit)
  if (troubles.get(brandId)?.kind !== 'changed') troubles.delete(brandId)
  revise(brandId)
}

/** Shows that the kit can't be read, and which parts of the kit the tab showed weren't saved. */
function showUnreadable(brandId: string, unsaved: KitPart[]) {
  kits.delete(brandId)
  storedKits.delete(brandId)
  troubles.set(brandId, { kind: 'unreadable', unsaved })
  revise(brandId)
}

function useSubscribe(brandId: string) {
  return useCallback(
    (listener: () => void) => {
      const set = listeners.get(brandId) ?? new Set()
      listeners.set(brandId, set.add(listener))
      return () => {
        set.delete(listener)
      }
    },
    [brandId],
  )
}

async function save(workspaceId: string, brandId: string, kit: BrandKit) {
  try {
    const response = await fetch(brandPath(workspaceId, brandId, 'kit', 'data'), {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...kit, basedOn: storedKits.get(brandId)?.updatedAt }),
    })
    const body: unknown = await response.json().catch(() => null)
    if (response.status === 409) return await reloadRefused(workspaceId, brandId)
    if (!response.ok) throw RouteError.fromBody(response.status, body)
    const stored = StoredBrandKit.safeParse(body)
    if (stored.success) storedKits.set(brandId, stored.data)
    if (troubles.get(brandId)?.kind === 'failed') troubles.delete(brandId)
  } catch (e) {
    troubles.set(brandId, { kind: 'failed', reason: e instanceof Error ? e.message : String(e) })
  }
  revise(brandId)
}

/**
 * After a save refused, since the kit was saved elsewhere since the tab's kit: shows the newer kit
 * and says which parts of the tab's kit weren't saved. The changes made on the older kit, waiting
 * or made while it is fetched, are not saved.
 */
async function reloadRefused(workspaceId: string, brandId: string) {
  const fetched = await fetchKit(workspaceId, brandId)
  const change = waiting.get(brandId)
  if (change) clearTimeout(change.timer)
  waiting.delete(brandId)
  const shown = kits.get(brandId)
  const from = storedKits.get(brandId)
  const unsaved = shown && from ? changedParts(from, shown) : []
  if (!fetched) return showUnreadable(brandId, unsaved)
  troubles.set(brandId, { kind: 'changed', unsaved })
  show(brandId, fetched)
}
