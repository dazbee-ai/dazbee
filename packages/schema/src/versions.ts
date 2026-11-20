// A design's versions: the kinds a version is, the limits its history keeps to, and the mark a
// restore carries, which the tab sends with the restore's change set and the sync server passes on.
import { z } from 'zod'

import { Id } from './primitives.ts'
import type { DesignRecords } from './sync.ts'

/** The limits of a design's version history, each defined once. */
export const VERSION_LIMITS = {
  /** The versions a design keeps, of every kind. */
  versions: 100,
  /** The automatic versions it keeps (`auto`, `beforeRestore` and `beforeAgent`); named ones are never dropped. */
  automatic: 20,
  /** A version's name and its description, in characters. */
  nameChars: 200,
  descriptionChars: 2000,
  /** How long a design changes before the sync server takes an Autosave. */
  autosaveMs: 30 * 60 * 1000,
} as const

/**
 * What a version is: named by an Editor, an Autosave, the design as it was just before a restore, or
 * the design as it was just before an agent's first change to it, named by the agent.
 */
export const VersionKind = z.enum(['named', 'auto', 'beforeRestore', 'beforeAgent'])
export type VersionKind = z.infer<typeof VersionKind>

/** What adding a version stores. */
export interface NewVersion {
  kind: VersionKind
  /** Empty for an automatic version, but for a Before agent one, which holds the agent's name. */
  name: string
  description: string
  /** The user who named it; null for an automatic version. */
  savedBy: string | null
  /** The design's sync id and sequence number when it was taken. */
  syncId: string
  seq: number
  /** The schema version its records were stored under. */
  schemaVersion: number
  records: DesignRecords
  /** A version not to drop to make room for this one (the one a restore restores); null for none. */
  keep: string | null
}

/** A version as the history lists it. */
export const VersionSummary = z.object({
  id: z.string(),
  kind: VersionKind,
  /** Empty for an automatic version, but for a Before agent one, which holds the agent's name. */
  name: z.string(),
  description: z.string(),
  /** The name of who named it; null for an automatic version or a person gone. */
  savedBy: z.string().nullable(),
  takenAt: z.iso.datetime(),
})
export type VersionSummary = z.infer<typeof VersionSummary>

/** Saves the design as a named version; an empty name becomes "Version N". */
export const SaveVersion = z.object({
  name: z.string().trim().max(VERSION_LIMITS.nameChars),
  description: z.string().max(VERSION_LIMITS.descriptionChars).optional(),
})
export type SaveVersion = z.infer<typeof SaveVersion>

/** Renames a version, and sets its description when given. */
export const RenameVersion = z.object({
  name: z.string().trim().min(1).max(VERSION_LIMITS.nameChars),
  description: z.string().max(VERSION_LIMITS.descriptionChars).optional(),
})
export type RenameVersion = z.infer<typeof RenameVersion>

/** Makes a design from a version; named after the design and the version when no name is given. */
export const CopyVersion = z.object({ name: z.string().trim().min(1).max(120).optional() })
export type CopyVersion = z.infer<typeof CopyVersion>

/** The version a restore puts back, as the restore's change set carries it and the other tabs are told. */
export const RestoreMark = z.strictObject({
  versionId: Id.describe('The version’s id.'),
  kind: VersionKind.describe('named, auto for an Autosave, beforeRestore, or beforeAgent.'),
  name: z
    .string()
    .max(VERSION_LIMITS.nameChars)
    .describe('Its name; empty for an automatic version, but the agent’s name for a beforeAgent one.'),
  takenAt: z.iso.datetime().describe('When it was taken, as an ISO time.'),
})
export type RestoreMark = z.infer<typeof RestoreMark>
