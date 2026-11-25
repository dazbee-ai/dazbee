'use client'

// The AI section's AI steps: the model each AI step runs, its kind's default or its own, picked from the priced
// models of the step's kind, with the options its call passes the model as JSON, each step saved on its own;
// saving gives the step its own model, and a step with one can go back to its kind's default. A text step
// shows its sizes as set in the step list beside those its calls on its model measured. The two draft steps
// are the modes.
import { useState } from 'react'

import type { AiStepModelView } from '@dazbee/schema'

import { removeStepOverride, saveStepModel } from '@/app/pilot/ai/actions.ts'
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
  useAmount,
  useChange,
} from '@/components/pilot/ai-form.tsx'
import { Select } from '@/components/ui/select.tsx'
import { cn } from '@/lib/cn.ts'
import { useMessages } from '@/lib/i18n/client.tsx'
import { format } from '@/lib/i18n/index.ts'

/** How many measured calls a step needs before its measured sizes are shown. */
export const MEASURED_MIN_CALLS = 20

/** A change a row runs from where `at` names, through the table's `useChange`. */
type Run = (at: string, change: () => Promise<string | null>, done?: string) => void

/** Options read from `text`, a JSON object of strings, numbers and true or false; null otherwise. */
export function optionsOf(text: string): Record<string, string | number | boolean> | null {
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

/**
 * The models a step's or a kind's picker offers, its own model first when it is no longer of its kind, and the
 * one it shows: the one picked, or its own once the picked one is no longer offered, as after a save refused
 * because the picked model stopped being of its kind.
 */
export function modelChoices(
  step: { model: string; models: string[] },
  picked: string,
): { choices: string[]; shown: string } {
  const choices = step.models.includes(step.model) ? step.models : [step.model, ...step.models]
  return { choices, shown: choices.includes(picked) ? picked : step.model }
}

/**
 * The key a step's row is drawn under: it changes whenever the step's model or where it comes from changes,
 * so the row's picker starts again from what the page read, as after its kind's default changes.
 */
export function stepRowKey(step: AiStepModelView): string {
  return `${step.step}/${step.source}/${step.model}/${step.updatedAt}`
}

export function AiStepModels({ steps }: { steps: AiStepModelView[] }) {
  const w = useMessages().pilotAi.stepModels
  const { run, busy, noteAt, show } = useChange()
  return (
    <div data-testid="ai-step-models" className="flex flex-col gap-3">
      <AiHeading id="ai-steps-title" title={w.title} hint={w.hint} />
      <AiTable label={w.title}>
        <thead>
          <tr>
            <th className={HEAD}>{w.step}</th>
            <th className={HEAD}>{w.source}</th>
            <th className={HEAD}>{w.model}</th>
            <th className={HEAD}>{w.options}</th>
            <th className={HEAD}>{w.sizes}</th>
            <th className={HEAD} />
          </tr>
        </thead>
        <tbody>
          {steps.map((step) => (
            <StepRow
              key={stepRowKey(step)}
              step={step}
              run={run}
              busy={busy}
              note={noteAt(step.step)}
              onBadOptions={() => show(step.step, { text: w.badOptions, refused: true })}
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
  run,
  busy,
  note,
  onBadOptions,
}: {
  step: AiStepModelView
  run: Run
  busy: boolean
  /** What this row's last change came to. */
  note: ChangeNote | null
  onBadOptions: () => void
}) {
  const t = useMessages().pilotAi
  const w = t.stepModels
  const names = useAiNames()
  const [model, setModel] = useState(step.model)
  const [options, setOptions] = useState(JSON.stringify(step.options))
  const what = { step: names.step(step.step) }
  const { choices, shown } = modelChoices(step, model)
  function save() {
    const read = optionsOf(options)
    if (!read) return onBadOptions()
    run(step.step, () => saveStepModel(step.step, { model: shown, options: read, since: step.updatedAt }))
  }
  function followKind() {
    run(step.step, () => removeStepOverride(step.step, step.updatedAt), w.defaultUsed)
  }
  return (
    <>
      <tr data-step={step.step}>
        <td className={cn(CELL, 'font-semibold')}>{what.step}</td>
        <td className={cn(CELL, 'text-caption text-muted')}>{step.source === 'kind' ? w.fromKind : w.override}</td>
        <td className={CELL}>
          <Select
            name={`model-${step.step}`}
            label={format(w.modelFor, what)}
            value={shown}
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
        <td className={cn(CELL, 'text-caption')}>
          <StepSizes step={step} />
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
          {step.source === 'override' && (
            <button
              type="button"
              disabled={busy}
              onClick={followKind}
              aria-label={format(w.useDefaultFor, what)}
              className={cn(SAVE_BUTTON, 'ms-2')}
            >
              {w.useDefault}
            </button>
          )}
        </td>
      </tr>
      <NoteRow note={note} span={6} />
    </>
  )
}

/** A text step's sizes as set, and as measured once it has enough calls; nothing for another step. */
function StepSizes({ step }: { step: AiStepModelView }) {
  const w = useMessages().pilotAi.stepModels
  const amount = useAmount()
  if (!step.sizes) return null
  const calls = step.measured?.calls ?? 0
  return (
    <div data-sizes={step.step} className="flex min-w-48 max-w-72 flex-col gap-0.5 whitespace-normal">
      <span>
        {format(w.sizesSet, {
          input: amount(step.sizes.input, 0),
          output: amount(step.sizes.output, 0),
          ceiling: amount(step.sizes.ceiling, 0),
        })}
      </span>
      <span className="text-muted">
        {step.measured && calls >= MEASURED_MIN_CALLS
          ? format(w.sizesMeasured, {
              input: amount(step.measured.input.average, 0),
              inputP95: amount(step.measured.input.p95, 0),
              output: amount(step.measured.output.average, 0),
              outputP95: amount(step.measured.output.p95, 0),
              calls: amount(calls, 0),
              cutOff: amount(step.measured.cutOff, 0),
            })
          : format(w.tooFewCalls, { calls: amount(calls, 0), needed: MEASURED_MIN_CALLS })}
      </span>
    </div>
  )
}
