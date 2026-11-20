// A version of a design, read: every reader of a stored version (the API's copy and picture, the
// tab's viewer and restore) reads it here. It reads as a stored design does: each layer is carried
// over to this schema's version (`carryOverLayer`, which finds what to carry over in the layer
// itself), a part the schema does not take is left out and told, and the rest opens.
import type { Design, DesignRecords } from '@dazbee/schema'

import { type LeftOut, repair } from './repair.ts'

/** A version read: its design, and what the read left out, for the reader to tell or log. */
export interface ReadVersion {
  design: Design
  leftOut: LeftOut[]
}

/** The design a version's records hold, stored under `schemaVersion`. */
export function readVersion(records: DesignRecords, schemaVersion: number): ReadVersion {
  // Every schema version reads the same way: each carry-over step finds what it changes in the records themselves.
  void schemaVersion
  const { design, leftOut } = repair(records)
  return { design, leftOut }
}
