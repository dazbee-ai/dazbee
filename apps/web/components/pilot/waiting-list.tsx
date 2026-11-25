'use client'

// The admin page's Waiting list: each request to join, newest first, with its name, company, email, note and
// date, and Invite, which sends its email a Dazbee invite and takes it off the list, and Dismiss, which
// deletes it. Why the API refused shows under the heading.
import { useState, useTransition } from 'react'

import type { AccessRequest } from '@dazbee/schema'

import { dismiss, inviteFromList } from '@/app/pilot/access/actions.ts'
import { Note } from '@/components/settings/note.tsx'
import { buttonStyles } from '@/components/ui/button.tsx'
import { cn } from '@/lib/cn.ts'
import { useLocale, useMessages } from '@/lib/i18n/client.tsx'
import { format } from '@/lib/i18n/index.ts'

export function WaitingList({ requests }: { requests: AccessRequest[] }) {
  const t = useMessages().pilot
  const [refusal, setRefusal] = useState<string | null>(null)
  return (
    <div data-testid="waiting-list">
      <h2 id="waiting-title" className="text-label font-medium">
        {t.waiting.title}
      </h2>
      {refusal && <Note refused text={refusal} />}
      {requests.length === 0 ? (
        <p className="mt-2 text-label text-muted">{t.waiting.empty}</p>
      ) : (
        <ul aria-labelledby="waiting-title" className="-mx-2 mt-2 flex flex-col gap-0.5">
          {requests.map((each) => (
            <RequestRow
              key={each.id}
              request={each}
              onAct={() => setRefusal(null)}
              onRefused={(error) => setRefusal(format(t.refused, { email: each.email, error }))}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

/** One request, with Invite and Dismiss. */
function RequestRow({
  request,
  onAct,
  onRefused,
}: {
  request: AccessRequest
  onAct: () => void
  onRefused: (error: string) => void
}) {
  const w = useMessages().pilot.waiting
  const locale = useLocale()
  const [busy, startTransition] = useTransition()
  // In UTC, so the server and the browser draw the same date.
  const asked = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(
    new Date(request.requestedAt),
  )
  function act(change: () => Promise<string | null>) {
    onAct()
    startTransition(async () => {
      const error = await change()
      if (error) onRefused(error)
    })
  }
  const action = cn(buttonStyles({ variant: 'ghost', size: 'md' }), 'h-8 px-2.5 text-label font-semibold')
  return (
    <li
      data-request={request.email}
      aria-busy={busy || undefined}
      className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-row px-2 py-1.5 transition-colors duration-[var(--chrome-fast)] hover:bg-hover"
    >
      <span className="flex min-w-0 flex-1 basis-56 flex-col">
        <span className="text-small font-semibold [overflow-wrap:anywhere] text-text">
          {request.name} · {request.company}
        </span>
        <span className="text-caption [overflow-wrap:anywhere] text-subtle">
          <bdi>{request.email}</bdi> · <time dateTime={request.requestedAt}>{format(w.asked, { date: asked })}</time>
        </span>
        {request.note && (
          <span className="mt-0.5 text-caption [overflow-wrap:anywhere] whitespace-pre-line text-muted">
            {request.note}
          </span>
        )}
      </span>
      <span className="flex shrink-0 items-center gap-0.5">
        <button
          type="button"
          disabled={busy}
          onClick={() => act(() => inviteFromList(request.id, request.email))}
          aria-label={format(w.inviteFor, { email: request.email })}
          className={action}
        >
          {w.invite}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => act(() => dismiss(request.id))}
          aria-label={format(w.dismissFor, { email: request.email })}
          className={cn(action, 'text-danger hover:text-danger')}
        >
          {w.dismiss}
        </button>
      </span>
    </li>
  )
}
