'use client'

// The AI section's AI functions: each AI function with its presets as the code has them, what each preset's own
// calls measured, and under each preset the modes that use it, with whether a pick or the code chose it, and a
// button that points each other mode at it from the next job on; then the function's picks, newest first, with
// who made each and when in UTC. A preset with no done call has its cost and time marked as a first guess, and a
// newest pick the running code has no preset for is said beside its function. A table's cells wrap, so it fits its
// card without scrolling sideways.
import type { AiFunctionView, AiModePreset, AiPickView, AiPresetView } from '@dazbee/schema'

import { pickPreset } from '@/app/pilot/ai/actions.ts'
import {
  AiHeading,
  AiTable,
  CELL,
  type ChangeNote,
  ChangeShown,
  HEAD,
  SAVE_BUTTON,
  useAiNames,
  useAmount,
  useChange,
} from '@/components/pilot/ai-form.tsx'
import { Note } from '@/components/settings/note.tsx'
import { cn } from '@/lib/cn.ts'
import { useMessages } from '@/lib/i18n/client.tsx'
import type { Messages } from '@/lib/i18n/en.ts'
import { format } from '@/lib/i18n/index.ts'

/** A change a function's row runs from where `at` names, through the section's `useChange`. */
type Run = (at: string, change: () => Promise<string | null>, done?: string) => void

/** A small label in a cell: a mode that uses the preset, or that a number is a first guess. */
const CHIP = 'rounded-row bg-chip px-1.5 py-0.5 text-caption font-semibold whitespace-nowrap'

/** A header cell and a body cell whose words wrap, so a table narrows to its card. */
const WRAP_HEAD = cn(HEAD, 'whitespace-normal')
const WRAP_CELL = cn(CELL, 'whitespace-normal [overflow-wrap:anywhere]')

/** How many columns a preset's measurements take, which the line under them spans. */
const COLUMNS = 9

/** A pick's time in UTC to the second, as the costs count their days: `2026-11-27 06:30:05 UTC`. */
export function utcTime(iso: string): string {
  const time = new Date(iso).toISOString()
  return `${time.slice(0, 10)} ${time.slice(11, 19)} UTC`
}

/** A preset's settings as one line, such as `effort: low, tier: fast`; a dash when it passes none. */
export function settingsLine(settings: Record<string, unknown>): string {
  const entries = Object.entries(settings)
  return entries.length === 0 ? '—' : entries.map(([name, value]) => `${name}: ${String(value)}`).join(', ')
}

/** The modes of `fn` that use `preset`, and those that use another and so could be pointed at it. */
export function modesOf(fn: AiFunctionView, preset: string): { using: AiModePreset[]; others: AiModePreset[] } {
  return {
    using: fn.modes.filter((use) => use.preset === preset),
    others: fn.modes.filter((use) => use.preset !== preset),
  }
}

/** The word for a mode a pick is for: the mode's name, or every mode for a function no mode changes. */
function modeWord(w: Messages['pilotAi']['aiFunctions'], mode: string): string {
  if (mode === '') return w.modes.every
  const words: Record<string, string> = w.modes
  return Object.hasOwn(words, mode) ? (words[mode] ?? mode) : mode
}

export function AiFunctions({
  functions,
  picks,
}: {
  functions: AiFunctionView[]
  /** Each AI function's picks by its name, newest first. */
  picks: Record<string, AiPickView[]>
}) {
  const w = useMessages().pilotAi.aiFunctions
  const { run, busy, noteAt } = useChange()
  return (
    <div data-testid="ai-functions" className="flex flex-col gap-3">
      <AiHeading id="ai-functions-title" title={w.title} hint={w.hint} />
      <ul aria-labelledby="ai-functions-title" className="flex flex-col gap-6">
        {functions.map((fn) => (
          <FunctionPresets
            key={fn.function}
            fn={fn}
            picks={picks[fn.function] ?? []}
            run={run}
            busy={busy}
            note={noteAt(fn.function)}
          />
        ))}
      </ul>
    </div>
  )
}

/** One AI function: its presets with their measurements and the modes that use each, and its picks. */
function FunctionPresets({
  fn,
  picks,
  run,
  busy,
  note,
}: {
  fn: AiFunctionView
  picks: AiPickView[]
  run: Run
  busy: boolean
  /** What this function's last pick came to. */
  note: ChangeNote | null
}) {
  const w = useMessages().pilotAi.aiFunctions
  const name = useAiNames().fn(fn.function)
  const kind = Object.hasOwn(w.kinds, fn.kind) ? w.kinds[fn.kind] : fn.kind
  const end = cn(WRAP_HEAD, 'text-end')
  return (
    <li data-function={fn.function} className="flex flex-col gap-2">
      <h3 className="flex flex-wrap items-baseline gap-x-2 text-label font-semibold">
        {name}
        <span className="text-caption font-normal text-muted">{kind}</span>
      </h3>
      {fn.modes
        .filter((use) => use.lacking !== null)
        .map((use) => (
          <div key={use.mode} data-lacking={use.mode}>
            <Note
              refused
              text={format(w.lacking, { mode: modeWord(w, use.mode), preset: use.lacking ?? '', inUse: use.preset })}
            />
          </div>
        ))}
      <AiTable label={format(w.presetsOf, { function: name })}>
        <thead>
          <tr>
            <th className={WRAP_HEAD}>{w.preset}</th>
            <th className={WRAP_HEAD}>{w.model}</th>
            <th className={WRAP_HEAD}>{w.settings}</th>
            <th className={WRAP_HEAD}>{w.prompt}</th>
            <th className={end}>{w.cost}</th>
            <th className={end}>{w.seconds}</th>
            <th className={end}>{w.done}</th>
            <th className={end}>{w.cutOffs}</th>
            <th className={end}>{w.failures}</th>
          </tr>
        </thead>
        <tbody>
          {fn.presets.map((preset) => (
            <PresetRow key={preset.name} fn={fn} preset={preset} run={run} busy={busy} />
          ))}
        </tbody>
      </AiTable>
      <ChangeShown note={note} />
      <details data-picks={fn.function} className="text-small">
        <summary className="cursor-pointer text-caption font-semibold text-muted">
          {format(w.history, { count: picks.length })}
        </summary>
        {picks.length === 0 ? (
          <p className="mt-2 text-label text-muted">{w.noPicks}</p>
        ) : (
          <PickHistory name={name} picks={picks} />
        )}
      </details>
    </li>
  )
}

/**
 * One preset, as two rows: what it runs with and what its calls measured, then, on a line of its own under them,
 * the modes that use it and a button for each mode that could.
 */
function PresetRow({ fn, preset, run, busy }: { fn: AiFunctionView; preset: AiPresetView; run: Run; busy: boolean }) {
  const w = useMessages().pilotAi.aiFunctions
  const names = useAiNames()
  const amount = useAmount()
  const { using, others } = modesOf(fn, preset.name)
  const { measured } = preset
  function use(mode: AiModePreset) {
    const what = { mode: modeWord(w, mode.mode), preset: preset.name }
    run(
      fn.function,
      () => pickPreset({ function: fn.function, mode: mode.mode, preset: preset.name, since: mode.pickedAt }),
      format(w.picked, what),
    )
  }
  // A number that is a first guess says so under it.
  const guessed = (number: string) => (
    <>
      {number}
      {measured.firstGuess && (
        <span data-first-guess className={cn(CHIP, 'ms-auto mt-0.5 block w-fit font-normal')}>
          {w.firstGuess}
        </span>
      )}
    </>
  )
  return (
    <>
      <tr data-preset={preset.name} className="border-b-0!">
        <td className={cn(CELL, 'font-mono text-caption font-semibold')}>{preset.name}</td>
        <td className={cn(WRAP_CELL, 'font-mono text-caption')}>{preset.model}</td>
        <td className={cn(WRAP_CELL, 'font-mono text-caption')}>{settingsLine(preset.settings)}</td>
        <td className={cn(CELL, 'text-caption')}>{preset.ownPrompt ? w.ownPrompt : w.noOwnPrompt}</td>
        <td className={cn(CELL, 'text-end')}>{guessed(amount(measured.cost, 4))}</td>
        <td className={cn(CELL, 'text-end')}>{guessed(amount(measured.seconds, 0))}</td>
        <td className={cn(CELL, 'text-end')}>{amount(measured.done, 0)}</td>
        <td className={cn(CELL, 'text-end')}>{amount(measured.cutOffs, 0)}</td>
        <td className={cn(CELL, 'text-end')}>{amount(measured.failures, 0)}</td>
      </tr>
      <tr data-uses-of={preset.name}>
        <td colSpan={COLUMNS} className="px-2 pb-2 text-start">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-caption text-muted">{w.usedBy}</span>
            {using.length === 0 && <span className="text-caption text-muted">{w.usedByNone}</span>}
            {using.map((mode) => (
              <span key={mode.mode} data-uses={mode.mode} data-source={mode.source} className={CHIP}>
                {format(mode.source === 'pick' ? w.usesPicked : w.usesCode, { mode: modeWord(w, mode.mode) })}
              </span>
            ))}
            {others.map((mode) => {
              const what = { mode: modeWord(w, mode.mode), preset: preset.name, function: names.fn(fn.function) }
              return (
                <button
                  key={mode.mode}
                  type="button"
                  disabled={busy}
                  onClick={() => use(mode)}
                  data-use={mode.mode}
                  aria-label={format(w.useFor, what)}
                  className={SAVE_BUTTON}
                >
                  {format(w.use, what)}
                </button>
              )
            })}
          </div>
        </td>
      </tr>
    </>
  )
}

/** An AI function's picks, newest first: when each was made, for which mode, its preset, and who made it. */
function PickHistory({ name, picks }: { name: string; picks: AiPickView[] }) {
  const w = useMessages().pilotAi.aiFunctions
  return (
    <div className="mt-2">
      <AiTable label={format(w.picksOf, { function: name })}>
        <thead>
          <tr>
            <th className={WRAP_HEAD}>{w.when}</th>
            <th className={WRAP_HEAD}>{w.mode}</th>
            <th className={WRAP_HEAD}>{w.preset}</th>
            <th className={WRAP_HEAD}>{w.by}</th>
          </tr>
        </thead>
        <tbody>
          {picks.map((pick) => (
            <tr key={pick.id} data-pick={pick.id}>
              <td className={cn(CELL, 'whitespace-normal')}>
                <time dateTime={pick.setAt}>{utcTime(pick.setAt)}</time>
              </td>
              <td className={CELL}>{modeWord(w, pick.mode)}</td>
              <td className={cn(WRAP_CELL, 'font-mono text-caption')}>{pick.preset}</td>
              <td className={WRAP_CELL}>{pick.setBy ?? w.byNoOne}</td>
            </tr>
          ))}
        </tbody>
      </AiTable>
    </div>
  )
}
