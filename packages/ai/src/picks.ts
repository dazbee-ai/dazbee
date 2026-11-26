// Picks: an admin's choice of which preset a mode uses for an AI function, as rows only ever added; the presets a
// mode uses once picks are counted in, with where each comes from; and an AI function's picks, newest first.
import { and, asc, desc, eq, sql } from 'drizzle-orm'

import { aiPicks, type Db, type Tx } from '@dazbee/db'
import { AI_FUNCTIONS, AI_MODES, type AiFunction, type AiMode, type PickMode } from '@dazbee/schema'

import { defaultPreset, isAiFunction, presetOf } from './functions/ai-function.ts'
import { MODE_PRESETS, modeChanges } from './modes.ts'

/** A pick to add: the AI function, the mode it is for (`NO_MODE` for a function no mode changes), and its preset. */
export interface NewPick {
  function: string
  mode: string
  preset: string
  /** The admin making it. */
  by: string
}

/** A pick as it is kept. */
export interface KeptPick {
  id: number
  mode: string
  preset: string
  setBy: string
  setAt: Date
}

/** The preset one mode uses for an AI function, and what chose it. */
export interface PresetInUse {
  /** The mode, or `NO_MODE` for an AI function no mode changes. */
  mode: PickMode
  preset: string
  /** A pick, or the code: the modes list, or else the function's default. */
  source: 'pick' | 'code'
  /** The newest pick's preset when the code has none by that name, so the code's own choice runs. */
  lacking: string | null
  /** When the newest pick for the function and mode was made; null with none. */
  pickedAt: Date | null
}

/** The newest pick of an AI function under a mode. */
interface Newest {
  fn: string
  mode: string
  preset: string
  setAt: Date
}

/** The mode a pick is kept under for an AI function no mode changes. */
export const NO_MODE = '' satisfies PickMode

/** Why a pick was refused: the code has no such AI function or preset, or the mode is none the function is picked for. */
export class PickRefused extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PickRefused'
  }
}

/**
 * The preset each AI function uses in `mode`: the newest pick when the code has its preset, otherwise the modes
 * list's, otherwise the function's default. An AI function a mode changes is picked for by mode, any other under
 * no mode; with no mode given, a function a mode changes uses its default.
 */
export async function presetsFor(db: Db | Tx, mode: AiMode | null): Promise<Record<AiFunction, string>> {
  const picks = await newestPicks(db)
  const presets = {} as Record<AiFunction, string>
  for (const fn of AI_FUNCTIONS) {
    const under = modeChanges(fn) ? mode : NO_MODE
    presets[fn] = under === null ? defaultPreset(fn) : inUse(fn, under, picks).preset
  }
  return presets
}

/**
 * The preset every AI function uses in each mode it is picked for, as jobs asked for now would run it: whether a
 * pick or the code chose it, a newest pick the code has no preset for, and when the newest pick was made.
 */
export async function presetsInUse(db: Db | Tx): Promise<Record<AiFunction, PresetInUse[]>> {
  const picks = await newestPicks(db)
  const all = {} as Record<AiFunction, PresetInUse[]>
  for (const fn of AI_FUNCTIONS) all[fn] = pickModes(fn).map((mode) => inUse(fn, mode, picks))
  return all
}

/** The modes an AI function is picked for: every mode when a mode changes it, otherwise no mode alone. */
export function pickModes(fn: AiFunction): PickMode[] {
  return modeChanges(fn) ? [...AI_MODES] : [NO_MODE]
}

/**
 * Adds a pick, live for the next job asked for: one row more, with no row changed or deleted, so picking an
 * earlier preset again is a pick like any other. Refused for an AI function or a preset the code doesn't have, and
 * for a mode the function isn't picked for. Two picks for the same function and mode run one after the other;
 * `check` is told when the newest one before it was made (null with none) and refuses the pick by throwing, with
 * nothing written.
 */
export async function addPick(db: Db | Tx, pick: NewPick, check?: (pickedAt: Date | null) => void): Promise<void> {
  const { function: fn, mode, preset } = pick
  if (!isAiFunction(fn)) throw new PickRefused(`There is no AI function ${fn}`)
  if (!(pickModes(fn) as string[]).includes(mode)) {
    throw new PickRefused(
      modeChanges(fn) ? `${fn} is picked for one of ${AI_MODES.join(', ')}` : `No mode changes ${fn}`,
    )
  }
  if (!presetOf(fn, preset)) throw new PickRefused(`${fn} has no preset ${preset}`)
  await db.transaction(async (tx) => {
    // Held until the transaction ends, so the second of two picks made at once sees the first.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`ai-picks:${fn}/${mode}`}))`)
    const [newest] = await tx
      .select({ setAt: aiPicks.setAt })
      .from(aiPicks)
      .where(and(eq(aiPicks.function, fn), eq(aiPicks.mode, mode)))
      .orderBy(desc(aiPicks.id))
      .limit(1)
    check?.(newest?.setAt ?? null)
    // Always later than the pick before it, so the time of a pick names it alone.
    const setAt = new Date(Math.max(Date.now(), (newest?.setAt.getTime() ?? 0) + 1))
    await tx.insert(aiPicks).values({ function: fn, mode, preset, setBy: pick.by, setAt })
  })
}

/** The picks made for an AI function, in every mode, the newest first, at most `limit` of them. */
export async function picksOf(db: Db | Tx, fn: string, limit: number): Promise<KeptPick[]> {
  return db
    .select({
      id: aiPicks.id,
      mode: aiPicks.mode,
      preset: aiPicks.preset,
      setBy: aiPicks.setBy,
      setAt: aiPicks.setAt,
    })
    .from(aiPicks)
    .where(eq(aiPicks.function, fn))
    .orderBy(desc(aiPicks.id))
    .limit(limit)
}

/** The newest pick of each function and mode, read through the index on them. */
async function newestPicks(db: Db | Tx): Promise<Newest[]> {
  return db
    .selectDistinctOn([aiPicks.function, aiPicks.mode], {
      fn: aiPicks.function,
      mode: aiPicks.mode,
      preset: aiPicks.preset,
      setAt: aiPicks.setAt,
    })
    .from(aiPicks)
    .orderBy(asc(aiPicks.function), asc(aiPicks.mode), desc(aiPicks.id))
}

/**
 * The preset `fn` uses under `mode`. The newest pick decides, even when the code has no such preset: then the
 * code's own choice runs, and an older pick never comes back by itself.
 */
function inUse(fn: AiFunction, mode: PickMode, picks: Newest[]): PresetInUse {
  const newest = picks.find((pick) => pick.fn === fn && pick.mode === mode)
  const picked = newest !== undefined && presetOf(fn, newest.preset) !== null
  const own = (mode === NO_MODE ? undefined : MODE_PRESETS[mode][fn]) ?? defaultPreset(fn)
  return {
    mode,
    preset: newest && picked ? newest.preset : own,
    source: picked ? 'pick' : 'code',
    lacking: newest && !picked ? newest.preset : null,
    pickedAt: newest?.setAt ?? null,
  }
}
