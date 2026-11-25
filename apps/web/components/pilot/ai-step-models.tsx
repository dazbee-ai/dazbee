'use client'

// The AI section's AI steps: the model each AI step runs, picked from the models that have sellers, with the
// options its call passes the model as JSON, each step saved on its own. The two draft steps are the modes.
import { useState } from 'react'

import type { AiStepModelView } from '@dazbee/schema'

import { saveStepModel } from '@/app/pilot/ai/actions.ts'
import {
  AiHeading,
  AiTable,
  CELL,
  ChangeShown,
  FIELD,
  HEAD,
  SAVE_BUTTON,
  useAiNames,
  useChange,
} from '@/components/pilot/ai-form.tsx'
import { Select } from '@/components/ui/select.tsx'
import { cn } from '@/lib/cn.ts'
import { useMessages } from '@/lib/i18n/client.tsx'
import { format } from '@/lib/i18n/index.ts'

/** A change a row runs, through the table's `useChange`. */
type Run = (change: () => Promise<string | null>) => void

/** Options read from `text`, a JSON object of strings, numbers and true or false; null otherwise. */
function optionsOf(text: string): Record<string, string | number | boolean> | null {
  try {
    const value: unknown = JSON.parse(text.trim() || '{}')
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    const entries = Object.entries(value)
    return entries.every(([, v]) => ['string', 'number', 'boolean'].includes(typeof v))
      ? (Object.fromEntries(entries) as Record<string, string | number | boolean>)
      : null
  } catch {
    return null
  }
}

export function AiStepModels({ steps, models }: { steps: AiStepModelView[]; models: string[] }) {
  const w = useMessages().pilotAi.stepModels
  const { run, busy, note, setNote } = useChange()
  return (
    <div data-testid="ai-step-models" className="flex flex-col gap-3">
      <AiHeading id="ai-steps-title" title={w.title} hint={w.hint} />
      <ChangeShown note={note} />
      <AiTable label={w.title}>
        <thead>
          <tr>
            <th className={HEAD}>{w.step}</th>
            <th className={HEAD}>{w.model}</th>
            <th className={HEAD}>{w.options}</th>
            <th className={HEAD} />
          </tr>
        </thead>
        <tbody>
          {steps.map((step) => (
            <StepRow
              key={`${step.step}/${step.updatedAt}`}
              step={step}
              models={models}
              run={run}
              busy={busy}
              onBadOptions={() => setNote({ text: w.badOptions, refused: true })}
            />
          ))}
        </tbody>
      </AiTable>
    </div>
  )
}

/** One AI step, its model and options saved together. */
function StepRow({
  step,
  models,
  run,
  busy,
  onBadOptions,
}: {
  step: AiStepModelView
  models: string[]
  run: Run
  busy: boolean
  onBadOptions: () => void
}) {
  const t = useMessages().pilotAi
  const w = t.stepModels
  const names = useAiNames()
  const [model, setModel] = useState(step.model)
  const [options, setOptions] = useState(JSON.stringify(step.options))
  const what = { step: names.step(step.step) }
  const choices = models.includes(step.model) ? models : [step.model, ...models]
  function save() {
    const read = optionsOf(options)
    if (!read) return onBadOptions()
    run(() => saveStepModel(step.step, { model, options: read }))
  }
  return (
    <tr data-step={step.step}>
      <td className={cn(CELL, 'font-semibold')}>{what.step}</td>
      <td className={CELL}>
        <Select
          name={`model-${step.step}`}
          label={format(w.modelFor, what)}
          value={model}
          options={choices.map((m) => ({ value: m, label: m }))}
          onChange={setModel}
          className="h-8 px-2 font-mono text-caption"
        />
      </td>
      <td className={CELL}>
        <input
          name={`options-${step.step}`}
          value={options}
          onChange={(e) => setOptions(e.target.value)}
          aria-label={format(w.optionsFor, what)}
          className={cn(FIELD, 'w-56 font-mono text-caption')}
        />
      </td>
      <td className={CELL}>
        <button
          type="button"
          disabled={busy}
          onClick={save}
          aria-label={format(w.saveFor, what)}
          className={SAVE_BUTTON}
        >
          {t.save}
        </button>
      </td>
    </tr>
  )
}
