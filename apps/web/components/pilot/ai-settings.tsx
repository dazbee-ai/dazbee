'use client'

// The AI section's Settings: the usage rate, the spending stop, the job limit and the layer split's two fixed
// amounts, saved together, and today's spend against the spending stop, which says when the stop is in force.
import { useState } from 'react'

import type { AiSettingsView } from '@dazbee/schema'

import { saveAiSettings } from '@/app/pilot/ai/actions.ts'
import { AiHeading, ChangeShown, FIELD, MAIN_BUTTON, useAmount, useChange } from '@/components/pilot/ai-form.tsx'
import { cn } from '@/lib/cn.ts'
import { useMessages } from '@/lib/i18n/client.tsx'
import { format } from '@/lib/i18n/index.ts'

/** The settings an admin sets, in the order the form shows them. */
const FIELDS = ['usageRate', 'spendingStop', 'jobLimit', 'layerSplit512', 'layerSplit1024'] as const

export function AiSettings({ settings }: { settings: AiSettingsView }) {
  const t = useMessages().pilotAi
  const w = t.settings
  const amount = useAmount()
  const { run, busy, note } = useChange()
  const [values, setValues] = useState(() => Object.fromEntries(FIELDS.map((f) => [f, String(settings[f])])))
  function save() {
    const numbers = Object.fromEntries(FIELDS.map((f) => [f, Number(values[f])])) as Record<
      (typeof FIELDS)[number],
      number
    >
    run(() => saveAiSettings(numbers))
  }
  return (
    <form
      aria-labelledby="ai-settings-title"
      data-testid="ai-settings"
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        save()
      }}
    >
      <AiHeading id="ai-settings-title" title={w.title} />
      <p
        role="status"
        data-stopped={settings.stopped || undefined}
        className={cn('text-label', settings.stopped ? 'font-semibold text-danger' : 'text-muted')}
      >
        {format(w.spent, { spent: amount(settings.spentToday), stop: amount(settings.spendingStop) })}
        {settings.stopped && <span className="block">{w.stopped}</span>}
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {FIELDS.map((field) => (
          <label key={field} className="flex flex-col gap-1 text-caption text-muted">
            {w[field]}
            <input
              name={field}
              type="number"
              required
              min={field === 'jobLimit' ? 1 : field === 'usageRate' ? 0.000001 : 0}
              max={field === 'jobLimit' ? 100 : undefined}
              step={field === 'jobLimit' ? 1 : 'any'}
              value={values[field]}
              onChange={(e) => setValues({ ...values, [field]: e.target.value })}
              className={cn(FIELD, 'text-text')}
            />
          </label>
        ))}
      </div>
      <p className="text-caption text-muted">{w.usageRateHint}</p>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={busy} className={MAIN_BUTTON}>
          {busy ? t.saving : t.save}
        </button>
        <ChangeShown note={note} />
      </div>
    </form>
  )
}
