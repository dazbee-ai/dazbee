// The Versions card's and the version bar's rules: a version's title, byline and what the bar and a
// restore say in the page's words, what a member may do, whether Save version and Restore are offered
// now, the names a save, a rename and a copy send, a restore's mark, and the wait for the tab to be
// Saved before a save, since a named version is taken from the design as stored.
import { type RestoreMark, VERSION_LIMITS, type VersionSummary } from '@dazbee/schema'

import { format, type Locale, type Messages } from '@/lib/i18n/index.ts'

import type { ValueStore } from './value-store.ts'

/** What a member may do: save a version, rename or delete one from its row's ⋯, and from the bar restore one or open it as a copy. */
export interface VersionItems {
  save: boolean
  rename: boolean
  remove: boolean
  restore: boolean
  copy: boolean
}

/** Why Save version is off, by its words: Offline, a tab that saves nothing, or a history full of named versions. */
export type SaveBlocked = 'offline' | 'notSaving' | 'full'

type Words = Messages['editor']['versions']

/** The longest name a design takes, which a copy's name is cut to. */
const DESIGN_NAME_CHARS = 120
/** How a version's time reads: day, month and time, as "16 Nov, 14:30". */
const TAKEN_AT = { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' } as const
/** The save states in which a tab saves to the server, or is about to. */
const SAVING = new Set(['Saved', 'Saving', 'Connecting'])

/** A version's title: its name, or Autosave, Before restore or Before and the agent's name for an automatic one. */
export function versionTitle(version: Pick<VersionSummary, 'kind' | 'name'>, words: Words) {
  if (version.kind === 'auto') return words.autosave
  if (version.kind === 'beforeRestore') return words.beforeRestore
  if (version.kind === 'beforeAgent')
    return version.name ? format(words.beforeAgent, { agent: version.name }) : words.beforeAgentUnnamed
  return version.name
}

/** When a version was taken, as the page's locale writes a day, a month and a time. */
export function versionTime(locale: Locale, takenAt: string) {
  return new Intl.DateTimeFormat(locale, TAKEN_AT).format(new Date(takenAt))
}

/** Under a version's title: who named it (Automatic for an automatic one, Someone for a person gone), and when. */
export function versionByline(locale: Locale, version: VersionSummary, words: Words) {
  const who = version.kind === 'named' ? (version.savedBy?.trim() ?? '') || words.someone : words.automatic
  return format(words.byline, { who, time: versionTime(locale, version.takenAt) })
}

/** What a member may do: a member whose role writes saves, renames, deletes, restores and copies; a Reviewer only looks. */
export function versionItems(writes: boolean): VersionItems {
  return { save: writes, rename: writes, remove: writes, restore: writes, copy: writes }
}

/** What the bar over a viewed version says: which version the canvas shows, and when it was taken. */
export function viewingWords(locale: Locale, version: VersionSummary, words: Words) {
  const time = versionTime(locale, version.takenAt)
  return version.kind === 'named'
    ? format(words.viewingNamed, { name: version.name, time })
    : format(words.viewingAutomatic, { name: versionTitle(version, words), time })
}

/** What the page says once a restore is done: a named version by its name, an automatic one by when it was taken. */
export function restoredWords(locale: Locale, version: VersionSummary, words: Words) {
  return version.kind === 'named'
    ? format(words.restoredNamed, { name: version.name })
    : format(words.restoredAt, { time: versionTime(locale, version.takenAt) })
}

/**
 * Why Save version is off now, or null while it is offered: the tab must save to the server, and
 * the history must not be full of named versions, which nothing makes room in.
 */
export function saveBlocked(status: string, versions: readonly VersionSummary[]): SaveBlocked | null {
  return notSaving(status) ?? (historyFull(versions) ? 'full' : null)
}

/**
 * Why Restore is off now, or null while it is offered: the tab must be connected, and the history
 * must make room for the Before restore version kept first, which drops the oldest automatic one but
 * never the one restored (`versionId`).
 */
export function restoreBlocked(
  status: string,
  versions: readonly VersionSummary[],
  versionId: string,
): SaveBlocked | null {
  const roomless =
    versions.length >= VERSION_LIMITS.versions && versions.every((v) => v.kind === 'named' || v.id === versionId)
  return notSaving(status) ?? (roomless ? 'full' : null)
}

/** The mark a restore of `version` carries, which the other tabs are told. */
export function restoreMark(version: VersionSummary): RestoreMark {
  return { versionId: version.id, kind: version.kind, name: version.name, takenAt: version.takenAt }
}

/** A copy's name: the design's, then the version's title in brackets, in the page's words, cut to a design name's length. */
export function copyName(designName: string, version: VersionSummary, words: Words) {
  return format(words.copyName, { design: designName, version: versionTitle(version, words) }).slice(
    0,
    DESIGN_NAME_CHARS,
  )
}

/** The name a save sends: the name typed, or "Version N" in the page's language, N one more than the versions listed. */
export function savedName(typed: string, words: Words, versions: readonly VersionSummary[]) {
  return typed.trim() || format(words.defaultName, { n: versions.length + 1 })
}

/** The name a rename sends, or null when it changes nothing: an empty name, or the title the version shows already. */
export function renamedTo(version: VersionSummary, typed: string, words: Words): string | null {
  const name = typed.trim()
  return name && name !== versionTitle(version, words) ? name : null
}

/**
 * Waits until the tab is Saved, so a named version, taken from the design as stored, holds every
 * edit made so far; answers why not instead once the tab goes Offline or stops saving.
 */
export function whenSaved(status: ValueStore<string>): Promise<'saved' | 'offline' | 'notSaving'> {
  return new Promise((resolve) => {
    const answer = () => {
      const now = status.get()
      return now === 'Saved' ? 'saved' : notSaving(now)
    }
    const first = answer()
    if (first) {
      resolve(first)
      return
    }
    const stop = status.subscribe(() => {
      const now = answer()
      if (!now) return
      stop()
      resolve(now)
    })
  })
}

/** Why a tab in save state `status` saves nothing to the server, or null while it does or is about to. */
function notSaving(status: string): 'offline' | 'notSaving' | null {
  if (status === 'Offline') return 'offline'
  return SAVING.has(status) ? null : 'notSaving'
}

/** Whether the history holds as many versions as it keeps, every one named, so a named save is refused. */
function historyFull(versions: readonly VersionSummary[]) {
  return versions.length >= VERSION_LIMITS.versions && versions.every((v) => v.kind === 'named')
}
