'use client'

// The admin page's Pending invites and Joined. A pending Dazbee invite shows in the Members part's invite
// row, with Copy link, Resend and Cancel. A person who joined shows with their name, email and the date they
// joined, and Remove, which asks first and then refuses their sign-in, keeping their designs. Why the API
// refused shows under each part's heading.
import { useState, useTransition } from 'react'

import type { DazbeeInvite, InvitedPerson } from '@dazbee/schema'

import { cancel, remove, resend } from '@/app/pilot/access/actions.ts'
import { ConfirmMenu } from '@/components/settings/confirm-menu.tsx'
import { Note } from '@/components/settings/note.tsx'
import { InviteRow } from '@/components/settings/pending-invites.tsx'
import { buttonStyles } from '@/components/ui/button.tsx'
import { cn } from '@/lib/cn.ts'
import { useLocale, useMessages } from '@/lib/i18n/client.tsx'
import { format } from '@/lib/i18n/index.ts'

export function PendingDazbeeInvites({ invites }: { invites: DazbeeInvite[] }) {
  const t = useMessages().pilot
  const [refusal, setRefusal] = useState<string | null>(null)
  if (invites.length === 0 && !refusal) return null
  return (
    <div data-testid="pilot-pending">
      <h2 id="pilot-pending-title" className="text-body font-semibold">
        {t.pending.title}
      </h2>
      {refusal && <Note refused text={refusal} />}
      <ul aria-labelledby="pilot-pending-title" className="-mx-2 mt-2 flex flex-col gap-0.5">
        {invites.map((each) => (
          <InviteRow
            key={each.id}
            invite={each}
            revoke={{ label: t.pending.cancel, labelFor: t.pending.cancelFor }}
            onResend={() => resend(each.id)}
            onRevoke={() => cancel(each.id)}
            onAct={() => setRefusal(null)}
            onRefused={(error) => setRefusal(format(t.refused, { email: each.email, error }))}
          />
        ))}
      </ul>
    </div>
  )
}

export function JoinedPeople({ people }: { people: InvitedPerson[] }) {
  const t = useMessages().pilot
  const [refusal, setRefusal] = useState<string | null>(null)
  return (
    <div data-testid="pilot-joined">
      <h2 id="pilot-joined-title" className="text-body font-semibold">
        {t.joined.title}
      </h2>
      {refusal && <Note refused text={refusal} />}
      {people.length === 0 ? (
        <p className="mt-2 text-label text-muted">{t.joined.empty}</p>
      ) : (
        <ul aria-labelledby="pilot-joined-title" className="-mx-2 mt-2 flex flex-col gap-0.5">
          {people.map((each) => (
            <PersonRow
              key={each.id}
              person={each}
              onAct={() => setRefusal(null)}
              onRefused={(error) => setRefusal(format(t.refused, { email: each.email, error }))}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

/** One person who joined, with Remove. */
function PersonRow({
  person,
  onAct,
  onRefused,
}: {
  person: InvitedPerson
  onAct: () => void
  onRefused: (error: string) => void
}) {
  const w = useMessages().pilot.joined
  const locale = useLocale()
  const [busy, startTransition] = useTransition()
  // In UTC, so the server and the browser draw the same date.
  const since = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(person.at))
  function removePerson() {
    onAct()
    startTransition(async () => {
      const error = await remove(person.id)
      if (error) onRefused(error)
    })
  }
  return (
    <li
      data-person={person.email}
      aria-busy={busy || undefined}
      className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-row px-2 py-1.5 transition-colors duration-[var(--chrome-fast)] hover:bg-hover"
    >
      <span className="flex min-w-0 flex-1 basis-56 flex-col">
        <span title={person.email} className="truncate text-small font-semibold text-text">
          {person.name || person.email}
        </span>
        <span className="text-caption [overflow-wrap:anywhere] text-subtle">
          {person.name && (
            <>
              <bdi>{person.email}</bdi> ·{' '}
            </>
          )}
          <time dateTime={person.at}>{format(w.since, { date: since })}</time>
        </span>
      </span>
      <ConfirmMenu
        trigger={
          <button
            type="button"
            disabled={busy}
            aria-label={format(w.removeFor, { email: person.email })}
            className={cn(
              buttonStyles({ variant: 'ghost', size: 'md' }),
              'h-8 shrink-0 px-2.5 text-label font-semibold text-danger hover:text-danger',
            )}
          >
            {w.remove}
          </button>
        }
        label={format(w.removeFor, { email: person.email })}
        question={w.question}
        confirm={w.remove}
        cancel={w.keep}
        danger
        onConfirm={removePerson}
      />
    </li>
  )
}
