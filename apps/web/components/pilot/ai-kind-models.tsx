'use client'

// The AI section's kind defaults: the model each kind of AI call runs, picked from the priced models of that
// kind, with the options its call passes the model as JSON, and the AI steps that follow it. Before a default
// with steps following it changes model, the row warns that their sizes were set for the old model and saves
// only on a second press.
import { useState } from 'react'

import type { AiKindModelView } from '@dazbee/schema'

import { saveKindModel } from '@/app/pilot/ai/actions.ts'
import {
  AiHeading,
  AiTable,
  CELL,
  type ChangeNote,
  FIELD,
  HEAD,
  NoteRow,
  SAVE_BUTTON,
  useAiNames,
  useChange,
} from '@/components/pilot/ai-form.tsx'
import { modelChoices, optionsOf } from '@/components/pilot/ai-step-models.tsx'
import { Select } from '@/components/ui/select.tsx'
import { cn } from '@/lib/cn.ts'
import { useMessages } from '@/lib/i18n/client.tsx'
import { format } from '@/lib/i18n/index.ts'

/** A change a row runs from where `at` names, through the table's `useChange`. */
type Run = (at: string, change: () => Promise<string | null>) => void

/**
 * Whether saving `picked` as `kind`'s default should first warn that the steps following it were sized for its
 * model: it changes the model, steps follow it, and the warning wasn't shown for `picked` already.
 */
export function warnsBeforeSwitch(kind: AiKindModelView, picked: string, warned: string | null): boolean {
  return picked !== kind.model && kind.steps.length > 0 && warned !== picked
}

export function AiKindModels({ kinds }: { kinds: AiKindModelView[] }) {
  const w = useMessages().pilotAi.stepModels
  const { run, busy, noteAt, show } = useChange()
  return (
    <div data-testid="ai-kind-models" className="flex flex-col gap-3">
      <AiHeading id="ai-kinds-title" title={w.kindsTitle} hint={w.kindsHint} />
      <AiTable label={w.kindsTitle}>
        <thead>
          <tr>
            <th className={HEAD}>{w.kind}</th>
            <th className={HEAD}>{w.model}</th>
            <th className={HEAD}>{w.options}</th>
            <th className={HEAD}>{w.followers}</th>
            <th className={HEAD} />
          </tr>
        </thead>
        <tbody>
          {kinds.map((kind) => (
            <KindRow
              key={`${kind.kind}/${kind.updatedAt}`}
              kind={kind}
              run={run}
              busy={busy}
              note={noteAt(kind.kind)}
              show={(note) => show(kind.kind, note)}
            />
          ))}
        </tbody>
      </AiTable>
    </div>
  )
}

/** One kind of AI call, its default model and options saved together. */
function KindRow({
  kind,
  run,
  busy,
  note,
  show,
}: {
  kind: AiKindModelView
  run: Run
  busy: boolean
  /** What this row's last change came to. */
  note: ChangeNote | null
  show: (note: ChangeNote) => void
}) {
  const t = useMessages().pilotAi
  const w = t.stepModels
  const names = useAiNames()
  const [model, setModel] = useState(kind.model)
  const [options, setOptions] = useState(JSON.stringify(kind.options))
  // The model the warning was shown for: a second press with the same model saves.
  const [warned, setWarned] = useState<string | null>(null)
  const what = { kind: w.kindNames[kind.kind] }
  const { choices, shown } = modelChoices(kind, model)
  function save() {
    const read = optionsOf(options)
    if (!read) return show({ text: w.badOptions, refused: true })
    if (warnsBeforeSwitch(kind, shown, warned)) {
      setWarned(shown)
      const steps = kind.steps.map((step) => names.step(step)).join(', ')
      return show({ text: format(w.switchWarning, { steps, model: kind.model }), refused: true })
    }
    run(kind.kind, () => saveKindModel(kind.kind, { model: shown, options: read, since: kind.updatedAt }))
  }
  return (
    <>
      <tr data-kind={kind.kind}>
        <td className={cn(CELL, 'font-semibold')}>{w.kindNames[kind.kind]}</td>
        <td className={CELL}>
          <Select
            name={`kind-model-${kind.kind}`}
            label={format(w.kindModelFor, what)}
            value={shown}
            options={choices.map((m) => ({ value: m, label: m }))}
            onChange={setModel}
            className="h-8 px-2 font-mono text-caption"
          />
        </td>
        <td className={CELL}>
          <input
            name={`kind-options-${kind.kind}`}
            value={options}
            onChange={(e) => setOptions(e.target.value)}
            aria-label={format(w.kindOptionsFor, what)}
            className={cn(FIELD, 'w-56 font-mono text-caption')}
          />
        </td>
        <td className={cn(CELL, 'text-caption text-muted')}>
          {kind.steps.length > 0 ? kind.steps.map((step) => names.step(step)).join(', ') : w.none}
        </td>
        <td className={CELL}>
          <button
            type="button"
            disabled={busy}
            onClick={save}
            aria-label={format(w.saveKindFor, what)}
            className={SAVE_BUTTON}
          >
            {t.save}
          </button>
        </td>
      </tr>
      <NoteRow note={note} span={5} />
    </>
  )
}
