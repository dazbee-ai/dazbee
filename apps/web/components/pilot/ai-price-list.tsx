'use client'

// The AI section's price list: each currency's rate in rupees, then each seller's price per million units of
// each model, in its currency, with its GST or fee, each saved or removed on its own, and a row that adds one.
import { useState } from 'react'

import {
  type AiPriceView,
  type CurrencyRateView,
  type Seller,
  SELLERS,
  USAGE_UNITS,
  type UsageUnit,
} from '@dazbee/schema'

import { removePrice, saveAiPrice, saveCurrencyRate } from '@/app/pilot/ai/actions.ts'
import {
  AiHeading,
  AiTable,
  CELL,
  ChangeShown,
  FIELD,
  HEAD,
  ROW_BUTTON,
  SAVE_BUTTON,
  useAiNames,
  useAmount,
  useChange,
} from '@/components/pilot/ai-form.tsx'
import { Select } from '@/components/ui/select.tsx'
import { cn } from '@/lib/cn.ts'
import { useMessages } from '@/lib/i18n/client.tsx'
import { format } from '@/lib/i18n/index.ts'

/** A change a row runs, through its table's `useChange`. */
type Run = (change: () => Promise<string | null>) => void

/** A Select in a table row. */
const ROW_SELECT = 'h-8 px-2 text-small'

export function AiPriceList({ rates, prices }: { rates: CurrencyRateView[]; prices: AiPriceView[] }) {
  const t = useMessages().pilotAi
  const w = t.prices
  const rateChange = useChange()
  const priceChange = useChange()
  return (
    <div data-testid="ai-price-list" className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <AiHeading id="ai-rates-title" title={t.rates.title} hint={t.rates.hint} />
        <ChangeShown note={rateChange.note} />
        <AiTable label={t.rates.title}>
          <thead>
            <tr>
              <th className={HEAD}>{t.rates.currency}</th>
              <th className={HEAD}>{t.rates.rate}</th>
              <th className={HEAD} />
            </tr>
          </thead>
          <tbody>
            {rates.map((rate) => (
              <RateRow
                key={`${rate.currency}/${rate.updatedAt}`}
                rate={rate}
                run={rateChange.run}
                busy={rateChange.busy}
              />
            ))}
            <NewRate key={rates.length} run={rateChange.run} busy={rateChange.busy} />
          </tbody>
        </AiTable>
      </div>
      <div className="flex flex-col gap-3">
        <AiHeading id="ai-prices-title" title={w.title} hint={w.hint} />
        <ChangeShown note={priceChange.note} />
        <AiTable label={w.title}>
          <thead>
            <tr>
              <th className={HEAD}>{w.model}</th>
              <th className={HEAD}>{w.seller}</th>
              <th className={HEAD}>{w.unit}</th>
              <th className={HEAD}>{w.currency}</th>
              <th className={HEAD}>{w.price}</th>
              <th className={HEAD}>{w.fee}</th>
              <th className={HEAD}>{w.perUnit}</th>
              <th className={HEAD} />
            </tr>
          </thead>
          <tbody>
            {prices.length === 0 && (
              <tr>
                <td colSpan={8} className={cn(CELL, 'text-muted')}>
                  {w.none}
                </td>
              </tr>
            )}
            {prices.map((price) => (
              <PriceRow
                key={`${price.seller}/${price.model}/${price.unit}/${price.updatedAt}`}
                price={price}
                run={priceChange.run}
                busy={priceChange.busy}
              />
            ))}
            <NewPrice
              key={prices.length}
              currencies={rates.map((r) => r.currency)}
              models={[...new Set(prices.map((p) => p.model))]}
              run={priceChange.run}
              busy={priceChange.busy}
            />
          </tbody>
        </AiTable>
      </div>
    </div>
  )
}

/** A currency's rate, which a rupee's row only shows, since a rupee is always worth 1. */
function RateRow({ rate, run, busy }: { rate: CurrencyRateView; run: Run; busy: boolean }) {
  const t = useMessages().pilotAi
  const w = t.rates
  const [value, setValue] = useState(String(rate.rate))
  const rupee = rate.currency === 'INR'
  return (
    <tr data-currency={rate.currency}>
      <td className={cn(CELL, 'font-semibold')}>{rate.currency}</td>
      <td className={CELL}>
        {rupee ? (
          rate.rate
        ) : (
          <input
            name={`rate-${rate.currency}`}
            type="number"
            min={0}
            step="any"
            required
            value={value}
            onChange={(e) => setValue(e.target.value)}
            aria-label={format(w.rateFor, { currency: rate.currency })}
            className={cn(FIELD, 'w-32')}
          />
        )}
      </td>
      <td className={CELL}>
        {!rupee && (
          <button
            type="button"
            disabled={busy}
            onClick={() => run(() => saveCurrencyRate(rate.currency, Number(value)))}
            aria-label={format(w.saveFor, { currency: rate.currency })}
            className={SAVE_BUTTON}
          >
            {t.save}
          </button>
        )}
      </td>
    </tr>
  )
}

/** A row that adds a currency with its rate. */
function NewRate({ run, busy }: { run: Run; busy: boolean }) {
  const w = useMessages().pilotAi.rates
  const [currency, setCurrency] = useState('')
  const [rate, setRate] = useState('')
  return (
    <tr>
      <td className={CELL}>
        <input
          name="new-currency"
          value={currency}
          maxLength={3}
          onChange={(e) => setCurrency(e.target.value.toUpperCase())}
          aria-label={w.newCurrency}
          placeholder={w.newCurrency}
          className={cn(FIELD, 'w-40')}
        />
      </td>
      <td className={CELL}>
        <input
          name="new-currency-rate"
          type="number"
          min={0}
          step="any"
          value={rate}
          onChange={(e) => setRate(e.target.value)}
          aria-label={w.rate}
          className={cn(FIELD, 'w-32')}
        />
      </td>
      <td className={CELL}>
        <button
          type="button"
          disabled={busy || currency.length !== 3 || rate === ''}
          onClick={() => run(() => saveCurrencyRate(currency, Number(rate)))}
          className={SAVE_BUTTON}
        >
          {w.add}
        </button>
      </td>
    </tr>
  )
}

/** One price, its price and GST or fee changed and saved on their own, or removed. */
function PriceRow({ price, run, busy }: { price: AiPriceView; run: Run; busy: boolean }) {
  const t = useMessages().pilotAi
  const w = t.prices
  const names = useAiNames()
  const amount = useAmount()
  const [perMillion, setPerMillion] = useState(String(price.pricePerMillion))
  const [fee, setFee] = useState(String(Math.round(price.fee * 1e6) / 1e4))
  const what = { seller: names.seller(price.seller), model: price.model, unit: names.unit(price.unit) }
  const key = `${price.seller}-${price.model}-${price.unit}`
  return (
    <tr data-price={key}>
      <td className={cn(CELL, 'font-mono text-caption')}>{price.model}</td>
      <td className={CELL}>{what.seller}</td>
      <td className={CELL}>{what.unit}</td>
      <td className={CELL}>{price.currency}</td>
      <td className={CELL}>
        <input
          name={`price-${key}`}
          type="number"
          min={0}
          step="any"
          required
          value={perMillion}
          onChange={(e) => setPerMillion(e.target.value)}
          aria-label={format(w.priceFor, what)}
          className={cn(FIELD, 'w-32')}
        />
      </td>
      <td className={CELL}>
        <input
          name={`fee-${key}`}
          type="number"
          min={0}
          max={100}
          step="any"
          required
          value={fee}
          onChange={(e) => setFee(e.target.value)}
          aria-label={format(w.feeFor, what)}
          className={cn(FIELD, 'w-20')}
        />
      </td>
      <td className={cn(CELL, 'text-caption text-muted')}>{amount(Number(perMillion) / 1e6, 8)}</td>
      <td className={cn(CELL, 'flex gap-0.5')}>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            run(() =>
              saveAiPrice({
                seller: price.seller as Seller,
                model: price.model,
                unit: price.unit,
                currency: price.currency,
                pricePerMillion: Number(perMillion),
                fee: Number(fee) / 100,
              }),
            )
          }
          aria-label={format(w.saveFor, what)}
          className={SAVE_BUTTON}
        >
          {t.save}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => run(() => removePrice(price.seller, price.model, price.unit))}
          aria-label={format(w.removeFor, what)}
          className={cn(ROW_BUTTON, 'text-danger hover:text-danger')}
        >
          {t.remove}
        </button>
      </td>
    </tr>
  )
}

/** A row that adds a price: a seller, a model, a unit and a currency, its price and its GST or fee. */
function NewPrice({
  currencies,
  models,
  run,
  busy,
}: {
  currencies: string[]
  models: string[]
  run: Run
  busy: boolean
}) {
  const w = useMessages().pilotAi.prices
  const names = useAiNames()
  const [seller, setSeller] = useState<Seller>('openai')
  const [model, setModel] = useState('')
  const [unit, setUnit] = useState<UsageUnit>('input-token')
  const [currency, setCurrency] = useState(currencies.includes('USD') ? 'USD' : (currencies[0] ?? 'INR'))
  const [perMillion, setPerMillion] = useState('')
  const [fee, setFee] = useState('0')
  const ready = model.trim() !== '' && perMillion !== '' && fee !== ''
  return (
    <tr data-testid="ai-new-price">
      <td className={CELL}>
        <input
          name="new-price-model"
          list="ai-price-models"
          value={model}
          onChange={(e) => setModel(e.target.value.toLowerCase())}
          aria-label={w.model}
          placeholder={w.model}
          className={cn(FIELD, 'w-44 font-mono text-caption')}
        />
        <datalist id="ai-price-models">
          {models.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      </td>
      <td className={CELL}>
        <Select
          name="new-price-seller"
          label={w.seller}
          value={seller}
          options={SELLERS.map((s) => ({ value: s, label: names.seller(s) }))}
          onChange={(value) => setSeller(value as Seller)}
          className={ROW_SELECT}
        />
      </td>
      <td className={CELL}>
        <Select
          name="new-price-unit"
          label={w.unit}
          value={unit}
          options={USAGE_UNITS.map((u) => ({ value: u, label: names.unit(u) }))}
          onChange={(value) => setUnit(value as UsageUnit)}
          className={ROW_SELECT}
        />
      </td>
      <td className={CELL}>
        <Select
          name="new-price-currency"
          label={w.currency}
          value={currency}
          options={currencies.map((c) => ({ value: c, label: c }))}
          onChange={setCurrency}
          className={ROW_SELECT}
        />
      </td>
      <td className={CELL}>
        <input
          name="new-price"
          type="number"
          min={0}
          step="any"
          value={perMillion}
          onChange={(e) => setPerMillion(e.target.value)}
          aria-label={w.price}
          className={cn(FIELD, 'w-32')}
        />
      </td>
      <td className={CELL}>
        <input
          name="new-price-fee"
          type="number"
          min={0}
          max={100}
          step="any"
          value={fee}
          onChange={(e) => setFee(e.target.value)}
          aria-label={w.fee}
          className={cn(FIELD, 'w-20')}
        />
      </td>
      <td className={CELL} />
      <td className={CELL}>
        <button
          type="button"
          disabled={busy || !ready}
          onClick={() =>
            run(() =>
              saveAiPrice({
                seller,
                model: model.trim(),
                unit,
                currency,
                pricePerMillion: Number(perMillion),
                fee: Number(fee) / 100,
              }),
            )
          }
          className={SAVE_BUTTON}
        >
          {w.add}
        </button>
      </td>
    </tr>
  )
}
