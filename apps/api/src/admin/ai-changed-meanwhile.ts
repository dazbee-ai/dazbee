// A save from a page that read an older copy: each admin AI save may name when what it changes was last
// changed, as its page read it, and is refused when that is not when it was last changed now.

/** Why a save was refused: what it changes was changed since its page read it. */
export class ChangedMeanwhile extends Error {
  constructor() {
    super('This changed since you opened it; reload to see the newest.')
    this.name = 'ChangedMeanwhile'
  }
}

/**
 * Refuses a save whose page read `since` when what it changes was last changed at `stored`, or had none
 * (null); a save that names no `since` is not checked.
 */
export function checkSince(stored: Date | null | undefined, since: string | null | undefined): void {
  if (since === undefined) return
  if ((stored?.toISOString() ?? null) !== since) throw new ChangedMeanwhile()
}
