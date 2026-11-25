'use client'

// What the parts of the admin page's AI section share: the look of their tables and fields, amounts drawn in
// the person's locale, a section's heading, and running a change with what came of it shown under it.
import { type ReactNode, useState, useTransition } from 'react'

import { Note } from '@/components/settings/note.tsx'
import { buttonStyles } from '@/components/ui/button.tsx'
import { TOUCH_FIELD } from '@/components/ui/looks.ts'
import { cn } from '@/lib/cn.ts'
import { useLocale, useMessages } from '@/lib/i18n/client.tsx'

/** What a change came to: done, or refused, with why. */
export interface ChangeNote {
  text: string
  refused: boolean
}

/** A table's header cell and body cell. */
export const HEAD = 'px-2 py-2 text-start align-bottom text-caption font-medium whitespace-nowrap text-muted'
export const CELL = 'px-2 py-1.5 text-start align-middle whitespace-nowrap'

/** A text or number field in a table or a small form. */
export const FIELD = `h-8 ${TOUCH_FIELD} min-w-0 rounded-row border border-line bg-bg px-2 text-small outline-none hover:border-line-strong focus:border-accent`

/** A row's small button, and the same in the danger colour. */
export const ROW_BUTTON = cn(buttonStyles({ variant: 'ghost', size: 'md' }), `h-8 ${TOUCH_FIELD} px-2 text-label`)
export const SAVE_BUTTON = cn(buttonStyles({ variant: 'secondary', size: 'md' }), `h-8 ${TOUCH_FIELD} px-3 text-label`)

/** A section's main button. */
export const MAIN_BUTTON = cn(buttonStyles({ variant: 'primary', size: 'md' }), `h-9 ${TOUCH_FIELD} px-4 font-semibold`)

/** The words for sellers, units and AI steps, each by its name; a name the catalog lacks is shown as it is. */
export function useAiNames() {
  const t = useMessages().pilotAi
  const named = (words: Record<string, string>, name: string) => (Object.hasOwn(words, name) ? words[name] : name)
  return {
    seller: (seller: string) => named(t.sellers, seller) ?? seller,
    unit: (unit: string) => named(t.units, unit) ?? unit,
    step: (step: string) => named(t.steps, step) ?? step,
  }
}

/** Draws an amount with at most `digits` decimals, in the person's locale. */
export function useAmount() {
  const locale = useLocale()
  return (amount: number, digits = 2) => new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(amount)
}

/** Draws a time in IST, the day the spending stop and gifts count in, with its offset; or only its day. */
export function useWhen() {
  const locale = useLocale()
  return (iso: string, { day = false } = {}) =>
    new Intl.DateTimeFormat(locale, {
      dateStyle: 'medium',
      ...(day ? {} : { timeStyle: 'short' }),
      timeZone: 'Asia/Kolkata',
    }).format(new Date(iso))
}

/**
 * Runs a change that gives why it was refused, or null, while `busy`; `note` then says it was done (with
 * `done`, or Saved) or why it was refused, until the next change starts. `onDone` runs once it is done.
 */
export function useChange() {
  const saved = useMessages().pilotAi.saved
  const [busy, startTransition] = useTransition()
  const [note, setNote] = useState<ChangeNote | null>(null)
  function run(change: () => Promise<string | null>, done = saved, onDone?: () => void) {
    setNote(null)
    startTransition(async () => {
      const refusal = await change()
      setNote(refusal ? { text: refusal, refused: true } : { text: done, refused: false })
      if (!refusal) onDone?.()
    })
  }
  return { run, busy, note, setNote }
}

/** A section's heading, with a line under it saying what it shows. */
export function AiHeading({ id, title, hint }: { id: string; title: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <h2 id={id} className="text-body font-semibold">
        {title}
      </h2>
      {hint && <p className="text-caption text-muted">{hint}</p>}
    </div>
  )
}

/** A dense table, a hairline under each row, that scrolls sideways when it is wider than its card. */
export function AiTable({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="-mx-2 overflow-x-auto">
      <table
        aria-label={label}
        className="w-full border-collapse text-small tabular-nums [&_tbody_tr]:border-b [&_tbody_tr]:border-line [&_tbody_tr:last-child]:border-b-0 [&_thead_tr]:border-b [&_thead_tr]:border-line-strong"
      >
        {children}
      </table>
    </div>
  )
}

/** What the last change came to, when there was one. */
export function ChangeShown({ note }: { note: ChangeNote | null }) {
  return note && <Note text={note.text} refused={note.refused} />
}
