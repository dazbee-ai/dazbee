'use client'

// The AI section's daily check: the sellers that said they are out of money in the last day, each seller-day
// of the call log against the seller's own figure with its red days marked, the usage files of the sellers
// with no report to fetch, with when each was last checked and a form that uploads the next one, and the
// unknown calls by seller and day.
import { useRef, useState, useTransition } from 'react'

import {
  type DailyCheck,
  type LastChecked,
  type OutOfMoney,
  type UnknownCalls,
  UPLOADED_SELLERS,
  type UploadedSeller,
} from '@dazbee/schema'

import { uploadSellerFile } from '@/app/pilot/ai/actions.ts'
import {
  AiHeading,
  AiTable,
  CELL,
  type ChangeNote,
  ChangeShown,
  HEAD,
  MAIN_BUTTON,
  useAiNames,
  useAmount,
  useWhen,
} from '@/components/pilot/ai-form.tsx'
import { Select } from '@/components/ui/select.tsx'
import { cn } from '@/lib/cn.ts'
import { useMessages } from '@/lib/i18n/client.tsx'
import { format } from '@/lib/i18n/index.ts'

/** The largest usage file sent, under the server's limit on what a change may carry. */
const MOST_BYTES = 900_000

export function AiDailyCheck({
  checks,
  lastChecked,
  unknownCalls,
  outOfMoney,
}: {
  checks: DailyCheck[]
  lastChecked: LastChecked[]
  unknownCalls: UnknownCalls[]
  outOfMoney: OutOfMoney[]
}) {
  const w = useMessages().pilotAi.checks
  const names = useAiNames()
  const amount = useAmount()
  const when = useWhen()
  const figure = (value: number | null) => (value === null ? '' : amount(value, 4))
  return (
    <div data-testid="ai-daily-check" className="flex flex-col gap-4">
      <AiHeading id="ai-checks-title" title={w.title} hint={w.hint} />
      {outOfMoney.length > 0 && (
        <div role="alert" data-testid="ai-out-of-money" className="flex flex-col gap-1 text-label text-danger">
          <span className="font-semibold">{w.outOfMoney}</span>
          {outOfMoney.map((each) => (
            <span key={each.seller}>
              {format(w.outOfMoneyLine, { seller: names.seller(each.seller), at: when(each.at) })}
            </span>
          ))}
        </div>
      )}
      <AiTable label={w.title}>
        <thead>
          <tr>
            <th className={HEAD}>{w.day}</th>
            <th className={HEAD}>{w.seller}</th>
            <th className={HEAD}>{w.currency}</th>
            <th className={cn(HEAD, 'text-end')}>{w.ours}</th>
            <th className={cn(HEAD, 'text-end')}>{w.theirs}</th>
            <th className={cn(HEAD, 'text-end')}>{w.outside}</th>
            <th className={HEAD}>{w.state}</th>
            <th className={HEAD}>{w.source}</th>
          </tr>
        </thead>
        <tbody>
          {checks.length === 0 && (
            <tr>
              <td colSpan={8} className={cn(CELL, 'text-muted')}>
                {w.none}
              </td>
            </tr>
          )}
          {checks.map((check) => (
            <tr
              key={`${check.seller}/${check.day}`}
              data-check={`${check.seller}/${check.day}`}
              data-state={check.state}
              className={cn(check.state === 'red' && 'bg-danger/10 font-semibold text-danger')}
            >
              <td className={CELL}>{check.day}</td>
              <td className={CELL}>{names.seller(check.seller)}</td>
              <td className={CELL}>{check.currency}</td>
              <td className={cn(CELL, 'text-end')}>{figure(check.ourCost)}</td>
              <td className={cn(CELL, 'text-end')}>{figure(check.sellerCost)}</td>
              <td className={cn(CELL, 'text-end')}>{figure(check.outsideCalls)}</td>
              <td className={CELL}>{w.states[check.state]}</td>
              <td className={CELL}>{check.source && w.sources[check.source]}</td>
            </tr>
          ))}
        </tbody>
      </AiTable>
      <h3 className="text-caption font-semibold">{w.lastChecked}</h3>
      <ul data-testid="ai-last-checked" className="flex flex-col gap-0.5 text-label">
        {lastChecked.map((each) => (
          <li key={each.seller} data-seller={each.seller}>
            {each.day && each.uploadedAt
              ? format(w.lastCheckedLine, {
                  seller: names.seller(each.seller),
                  day: each.day,
                  at: when(each.uploadedAt),
                })
              : format(w.never, { seller: names.seller(each.seller) })}
          </li>
        ))}
      </ul>
      <UploadForm />
      <AiHeading id="ai-unknown-title" title={w.unknown} hint={w.unknownHint} />
      {unknownCalls.length === 0 ? (
        <p className="text-label text-muted">{w.noUnknown}</p>
      ) : (
        <AiTable label={w.unknown}>
          <thead>
            <tr>
              <th className={HEAD}>{w.day}</th>
              <th className={HEAD}>{w.seller}</th>
              <th className={cn(HEAD, 'text-end')}>{w.calls}</th>
            </tr>
          </thead>
          <tbody>
            {unknownCalls.map((each) => (
              <tr key={`${each.seller}/${each.day}`}>
                <td className={CELL}>{each.day}</td>
                <td className={CELL}>{names.seller(each.seller)}</td>
                <td className={cn(CELL, 'text-end')}>{each.calls}</td>
              </tr>
            ))}
          </tbody>
        </AiTable>
      )}
    </div>
  )
}

/** Uploads a seller's usage file, a CSV, which checks each day it covers. */
function UploadForm() {
  const w = useMessages().pilotAi.checks
  const names = useAiNames()
  const [busy, startTransition] = useTransition()
  const [note, setNote] = useState<ChangeNote | null>(null)
  const [seller, setSeller] = useState<UploadedSeller>('meta')
  const file = useRef<HTMLInputElement>(null)
  function upload() {
    setNote(null)
    const picked = file.current?.files?.[0]
    if (!picked) return setNote({ text: w.noFile, refused: true })
    if (picked.size > MOST_BYTES) return setNote({ text: w.tooBig, refused: true })
    startTransition(async () => {
      const answer = await uploadSellerFile({ seller, name: picked.name, text: await picked.text() })
      if ('error' in answer) return setNote({ text: answer.error, refused: true })
      setNote({ text: format(w.sent, { days: answer.days.join(', ') }), refused: false })
      if (file.current) file.current.value = ''
    })
  }
  return (
    <form
      aria-label={w.upload}
      data-testid="ai-upload"
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault()
        upload()
      }}
    >
      <h3 className="text-caption font-semibold">{w.upload}</h3>
      <p className="text-caption text-muted">{w.uploadHint}</p>
      <div className="flex flex-wrap items-center gap-3">
        <Select
          name="upload-seller"
          label={w.seller}
          value={seller}
          options={UPLOADED_SELLERS.map((s) => ({ value: s, label: names.seller(s) }))}
          onChange={(value) => setSeller(value as UploadedSeller)}
          className="h-9 px-2 text-small"
        />
        <input
          ref={file}
          name="usage-file"
          type="file"
          accept=".csv,text/csv"
          aria-label={w.file}
          className="min-w-0 text-small file:me-3 file:rounded-row file:border file:border-line file:bg-raised file:px-3 file:py-1.5 file:text-label file:text-text"
        />
        <button type="submit" disabled={busy} className={MAIN_BUTTON}>
          {busy ? w.sending : w.send}
        </button>
      </div>
      <ChangeShown note={note} />
    </form>
  )
}
