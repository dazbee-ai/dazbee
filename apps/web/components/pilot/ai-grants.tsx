'use client'

// The AI section's gifts and grants: find a workspace by its name or a member's email, open it, give it a gift
// of allowance with its last day and a note, and read its grants, what is left on each, and its ledger,
// newest first. The search and the open workspace live in the page's address, so a reload keeps them.
import Link from 'next/link'
import { useState } from 'react'

import type { AiAllowanceView, AiWorkspace } from '@dazbee/schema'

import { giveGift } from '@/app/pilot/ai/actions.ts'
import {
  AiHeading,
  AiTable,
  CELL,
  ChangeShown,
  FIELD,
  HEAD,
  MAIN_BUTTON,
  ROW_BUTTON,
  SAVE_BUTTON,
  useAmount,
  useChange,
  useWhen,
} from '@/components/pilot/ai-form.tsx'
import { cn } from '@/lib/cn.ts'
import { useMessages } from '@/lib/i18n/client.tsx'
import { format } from '@/lib/i18n/index.ts'

/** How many days a gift lasts unless the admin picks another last day. */
const GIFT_DAYS = 30

/** The UTC day `days` from now, as YYYY-MM-DD. */
const dayIn = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)

export function AiGrants({
  query,
  found,
  allowance,
  keep,
}: {
  /** What the admin looked for, and the workspaces it found; null before a search of at least 2 characters. */
  query: string
  found: AiWorkspace[] | null
  allowance: AiAllowanceView | null
  /** The address's other settings, kept as the search changes. */
  keep: Record<string, string>
}) {
  const w = useMessages().pilotAi.grants
  const hrefOf = (workspace: string) => `?${new URLSearchParams({ ...keep, q: query, workspace })}`
  return (
    <div data-testid="ai-grants" className="flex flex-col gap-4">
      <AiHeading id="ai-grants-title" title={w.title} />
      <form method="get" role="search" className="flex flex-wrap items-center gap-2">
        {Object.entries(keep).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
        <input
          name="q"
          type="search"
          defaultValue={query}
          minLength={2}
          maxLength={200}
          required
          aria-label={w.find}
          placeholder={w.find}
          className={cn(FIELD, 'flex-1 basis-64')}
        />
        <button type="submit" className={SAVE_BUTTON}>
          {w.search}
        </button>
      </form>
      {query !== '' && found === null && <p className="text-caption text-muted">{w.short}</p>}
      {found?.length === 0 && <p className="text-label text-muted">{w.none}</p>}
      {found && found.length > 0 && (
        <ul aria-label={w.find} className="-mx-2 flex flex-col gap-0.5">
          {found.map((each) => (
            <li
              key={each.id}
              data-workspace={each.id}
              aria-current={allowance?.workspace.id === each.id || undefined}
              className="flex flex-wrap items-center gap-x-3 rounded-row px-2 py-1 aria-current:bg-hover"
            >
              <span className="flex min-w-0 flex-1 basis-56 flex-col">
                <span className="text-small font-semibold [overflow-wrap:anywhere]">{each.name}</span>
                <span className="text-caption [overflow-wrap:anywhere] text-subtle">{each.emails.join(', ')}</span>
              </span>
              <Link href={hrefOf(each.id)} aria-label={format(w.openFor, { name: each.name })} className={ROW_BUTTON}>
                {w.open}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {allowance && <Allowance key={allowance.workspace.id} allowance={allowance} />}
    </div>
  )
}

/** The open workspace: what is left, a gift, its grants and its ledger. */
function Allowance({ allowance }: { allowance: AiAllowanceView }) {
  const w = useMessages().pilotAi.grants
  const amount = useAmount()
  const when = useWhen()
  return (
    <div data-allowance={allowance.workspace.id} className="flex flex-col gap-4 border-t border-line pt-4">
      <div className="flex flex-col">
        <h3 className="text-label font-semibold [overflow-wrap:anywhere]">{allowance.workspace.name}</h3>
        <p className="text-caption [overflow-wrap:anywhere] text-subtle">{allowance.workspace.emails.join(', ')}</p>
        <p className="mt-1 text-label">{format(w.left, { left: amount(allowance.left, 4) })}</p>
      </div>
      <GiftForm workspaceId={allowance.workspace.id} />
      <h4 className="text-caption font-semibold">{w.grants}</h4>
      <AiTable label={w.grants}>
        <thead>
          <tr>
            <th className={HEAD}>{w.source}</th>
            <th className={cn(HEAD, 'text-end')}>{w.givenAmount}</th>
            <th className={cn(HEAD, 'text-end')}>{w.rate}</th>
            <th className={cn(HEAD, 'text-end')}>{w.leftColumn}</th>
            <th className={HEAD}>{w.expires}</th>
            <th className={HEAD}>{w.givenBy}</th>
            <th className={HEAD}>{w.note}</th>
          </tr>
        </thead>
        <tbody>
          {allowance.grants.length === 0 && (
            <tr>
              <td colSpan={7} className={cn(CELL, 'text-muted')}>
                {w.noGrants}
              </td>
            </tr>
          )}
          {allowance.grants.map((grant) => (
            <tr key={grant.id} data-grant={grant.id} className={cn(!grant.live && 'text-subtle')}>
              <td className={CELL}>{w.sources[grant.source]}</td>
              <td className={cn(CELL, 'text-end')}>{amount(grant.amount, 4)}</td>
              <td className={cn(CELL, 'text-end')}>{amount(grant.usageRate, 6)}</td>
              <td className={cn(CELL, 'text-end')}>{amount(grant.left, 4)}</td>
              <td className={CELL}>
                <time dateTime={grant.expiresAt}>{when(grant.expiresAt)}</time>
                {!grant.live && <span className="ms-1.5 text-caption font-semibold">{w.expired}</span>}
              </td>
              <td className={CELL}>{grant.givenBy}</td>
              <td className={cn(CELL, 'whitespace-normal [overflow-wrap:anywhere]')}>{grant.note}</td>
            </tr>
          ))}
        </tbody>
      </AiTable>
      <h4 className="text-caption font-semibold">{w.ledger}</h4>
      <AiTable label={w.ledger}>
        <thead>
          <tr>
            <th className={HEAD}>{w.when}</th>
            <th className={HEAD}>{w.kind}</th>
            <th className={cn(HEAD, 'text-end')}>{w.amountColumn}</th>
            <th className={HEAD}>{w.job}</th>
            <th className={HEAD}>{w.call}</th>
          </tr>
        </thead>
        <tbody>
          {allowance.ledger.length === 0 && (
            <tr>
              <td colSpan={5} className={cn(CELL, 'text-muted')}>
                {w.noLedger}
              </td>
            </tr>
          )}
          {allowance.ledger.map((row) => (
            <tr key={row.id}>
              <td className={CELL}>
                <time dateTime={row.createdAt}>{when(row.createdAt)}</time>
              </td>
              <td className={CELL}>{w.kinds[row.kind]}</td>
              <td className={cn(CELL, 'text-end')}>{amount(row.amount, 4)}</td>
              <td className={cn(CELL, 'font-mono text-caption')}>{row.jobId}</td>
              <td className={cn(CELL, 'font-mono text-caption')}>{row.callId}</td>
            </tr>
          ))}
        </tbody>
      </AiTable>
    </div>
  )
}

/** A gift to the workspace: an amount of allowance in rupees, its last day in IST, and a note. */
function GiftForm({ workspaceId }: { workspaceId: string }) {
  const w = useMessages().pilotAi.grants
  const amount = useAmount()
  const { run, busy, note } = useChange()
  const [given, setGiven] = useState('')
  const [lastDay, setLastDay] = useState(() => dayIn(GIFT_DAYS))
  const [text, setText] = useState('')
  return (
    <form
      aria-label={w.gift}
      data-testid="ai-gift"
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault()
        const gift = { amount: Number(given), expiresOn: lastDay, note: text }
        run(
          () => giveGift(workspaceId, gift),
          format(w.given, { amount: amount(gift.amount, 4) }),
          () => {
            setGiven('')
            setText('')
          },
        )
      }}
    >
      <h4 className="text-caption font-semibold">{w.gift}</h4>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-caption text-muted">
          {w.amount}
          <input
            name="gift-amount"
            type="number"
            min={0.000001}
            step="any"
            required
            value={given}
            onChange={(e) => setGiven(e.target.value)}
            className={cn(FIELD, 'w-40 text-text')}
          />
        </label>
        <label className="flex flex-col gap-1 text-caption text-muted">
          {w.expiresOn}
          <input
            name="gift-last-day"
            type="date"
            required
            min={dayIn(0)}
            value={lastDay}
            onChange={(e) => setLastDay(e.target.value)}
            className={cn(FIELD, 'text-text')}
          />
        </label>
        <label className="flex flex-1 basis-48 flex-col gap-1 text-caption text-muted">
          {w.note}
          <input
            name="gift-note"
            maxLength={500}
            value={text}
            onChange={(e) => setText(e.target.value)}
            className={cn(FIELD, 'text-text')}
          />
        </label>
        <button type="submit" disabled={busy} className={MAIN_BUTTON}>
          {busy ? w.giving : w.give}
        </button>
      </div>
      <ChangeShown note={note} />
    </form>
  )
}
