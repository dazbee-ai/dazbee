'use client'

// The AI section's seller order: each model's sellers in the order they are tried, each with its own name for
// the model where it differs, moved up or down, added or removed and saved together, and a row that adds a
// model with its first seller.
import { useState } from 'react'

import { type ModelSellersView, type Seller, SELLERS } from '@dazbee/schema'

import { saveSellerOrder } from '@/app/pilot/ai/actions.ts'
import {
  AiHeading,
  ChangeShown,
  FIELD,
  ROW_BUTTON,
  SAVE_BUTTON,
  useAiNames,
  useChange,
} from '@/components/pilot/ai-form.tsx'
import { Select } from '@/components/ui/select.tsx'
import { cn } from '@/lib/cn.ts'
import { useMessages } from '@/lib/i18n/client.tsx'
import { format } from '@/lib/i18n/index.ts'

/** A change a model's row runs, through the list's `useChange`. */
type Run = (change: () => Promise<string | null>) => void

/** A Select in a row. */
const ROW_SELECT = 'h-8 px-2 text-small'

export function AiSellerOrder({ models }: { models: ModelSellersView[] }) {
  const t = useMessages().pilotAi
  const { run, busy, note } = useChange()
  return (
    <div data-testid="ai-seller-order" className="flex flex-col gap-3">
      <AiHeading id="ai-order-title" title={t.order.title} hint={t.order.hint} />
      <ChangeShown note={note} />
      <ul aria-labelledby="ai-order-title" className="flex flex-col gap-4">
        {models.map((model) => (
          <ModelOrder key={JSON.stringify(model)} model={model} run={run} busy={busy} />
        ))}
      </ul>
      <NewModel key={models.length} run={run} busy={busy} />
    </div>
  )
}

/** One model's sellers in order, each moved, renamed or removed, and saved together. */
function ModelOrder({ model, run, busy }: { model: ModelSellersView; run: Run; busy: boolean }) {
  const t = useMessages().pilotAi
  const w = t.order
  const names = useAiNames()
  const [sellers, setSellers] = useState(model.sellers.map((s) => ({ ...s, sellerModel: s.sellerModel ?? '' })))
  const missing = SELLERS.filter((s) => !sellers.some((each) => each.seller === s))
  const move = (from: number, to: number) => {
    const next = [...sellers]
    const [moved] = next.splice(from, 1)
    if (moved) next.splice(to, 0, moved)
    setSellers(next)
  }
  const save = () =>
    run(() =>
      saveSellerOrder(model.model, {
        sellers: sellers.map((s) => ({
          seller: s.seller as Seller,
          sellerModel: s.sellerModel.trim() || null,
        })),
      }),
    )
  return (
    <li data-model={model.model} className="flex flex-col gap-1.5">
      <span className="font-mono text-caption font-semibold">{model.model}</span>
      <ol className="flex flex-col gap-1">
        {sellers.map((each, i) => {
          const what = { seller: names.seller(each.seller), model: model.model }
          return (
            <li key={each.seller} data-seller={each.seller} className="flex flex-wrap items-center gap-1.5">
              <span className="w-6 text-caption text-subtle tabular-nums">{i + 1}</span>
              <span className="w-24 text-small">{what.seller}</span>
              <input
                name={`seller-model-${model.model}-${each.seller}`}
                value={each.sellerModel}
                onChange={(e) =>
                  setSellers(sellers.map((s, j) => (j === i ? { ...s, sellerModel: e.target.value } : s)))
                }
                aria-label={format(w.sellerModelFor, what)}
                placeholder={w.sellerModel}
                className={cn(FIELD, 'w-56 font-mono text-caption')}
              />
              <button
                type="button"
                disabled={i === 0}
                onClick={() => move(i, i - 1)}
                aria-label={format(w.upFor, what)}
                className={ROW_BUTTON}
              >
                {w.up}
              </button>
              <button
                type="button"
                disabled={i === sellers.length - 1}
                onClick={() => move(i, i + 1)}
                aria-label={format(w.downFor, what)}
                className={ROW_BUTTON}
              >
                {w.down}
              </button>
              <button
                type="button"
                disabled={sellers.length === 1}
                onClick={() => setSellers(sellers.filter((_, j) => j !== i))}
                aria-label={format(w.removeFor, what)}
                className={cn(ROW_BUTTON, 'text-danger hover:text-danger')}
              >
                {t.remove}
              </button>
            </li>
          )
        })}
      </ol>
      <div className="flex flex-wrap items-center gap-1.5 ps-7">
        {missing.length > 0 && (
          <Select
            name={`add-seller-${model.model}`}
            label={format(w.addSellerFor, { model: model.model })}
            value=""
            placeholder={w.addSeller}
            options={missing.map((s) => ({ value: s, label: names.seller(s) }))}
            onChange={(seller) => setSellers([...sellers, { seller, sellerModel: '' }])}
            className={ROW_SELECT}
          />
        )}
        <button
          type="button"
          disabled={busy}
          onClick={save}
          aria-label={format(w.saveFor, { model: model.model })}
          className={SAVE_BUTTON}
        >
          {t.save}
        </button>
      </div>
    </li>
  )
}

/** A row that adds a model, with its first seller. */
function NewModel({ run, busy }: { run: Run; busy: boolean }) {
  const w = useMessages().pilotAi.order
  const names = useAiNames()
  const [model, setModel] = useState('')
  const [seller, setSeller] = useState<Seller>('openai')
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <input
        name="new-model"
        value={model}
        onChange={(e) => setModel(e.target.value.toLowerCase())}
        aria-label={w.newModel}
        placeholder={w.newModel}
        className={cn(FIELD, 'w-64 font-mono text-caption')}
      />
      <Select
        name="new-model-seller"
        label={w.addSeller}
        value={seller}
        options={SELLERS.map((s) => ({ value: s, label: names.seller(s) }))}
        onChange={(value) => setSeller(value as Seller)}
        className={ROW_SELECT}
      />
      <button
        type="button"
        disabled={busy || model.trim() === ''}
        onClick={() => run(() => saveSellerOrder(model.trim(), { sellers: [{ seller, sellerModel: null }] }))}
        className={SAVE_BUTTON}
      >
        {w.addModel}
      </button>
    </div>
  )
}
