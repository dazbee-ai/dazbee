'use client'

// The admin page's Invite: an email and Invite, which sends it a Dazbee invite. What the API answered shows
// under the form: to whom the invite was sent, or why it wasn't.
import { startTransition, useActionState, useState } from 'react'

import { invite, type PilotInviteAnswer } from '@/app/pilot/access/actions.ts'
import { Note } from '@/components/settings/note.tsx'
import { buttonStyles } from '@/components/ui/button.tsx'
import { cn } from '@/lib/cn.ts'
import { useMessages } from '@/lib/i18n/client.tsx'
import { format } from '@/lib/i18n/index.ts'

export function PilotInviteForm() {
  const w = useMessages().pilot.invite
  const [email, setEmail] = useState('')
  // The email stays as typed when the invite is refused, to fix and send again, and empties once it is sent.
  const [answer, send, sending] = useActionState<PilotInviteAnswer, FormData>(async (before, form) => {
    const answered = await invite(before, form)
    if (answered && 'sent' in answered) setEmail('')
    return answered
  }, null)
  // Whom an invite was sent to shows until the next email is typed; a refusal, until it is sent again.
  const shown = answer && ('error' in answer || !email) ? answer : null
  return (
    <form
      method="post"
      onSubmit={(event) => {
        event.preventDefault()
        const form = new FormData(event.currentTarget)
        startTransition(() => send(form))
      }}
      aria-labelledby="pilot-invite-title"
      data-testid="pilot-invite-form"
      className="flex flex-col gap-2"
    >
      <h2 id="pilot-invite-title" className="text-label font-medium">
        {w.title}
      </h2>
      <div className="flex flex-wrap items-center gap-3">
        <input
          name="email"
          type="email"
          required
          maxLength={254}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-label={w.email}
          placeholder={w.emailPlaceholder}
          autoComplete="off"
          aria-invalid={(shown !== null && 'error' in shown) || undefined}
          className="h-11 min-w-0 flex-1 basis-64 rounded-row border border-line bg-bg px-3 text-card outline-none hover:border-line-strong focus:border-accent"
        />
        <button
          type="submit"
          disabled={sending}
          className={cn(buttonStyles({ variant: 'primary', size: 'lg' }), 'h-11 px-7 font-semibold')}
        >
          {sending ? w.sending : w.send}
        </button>
      </div>
      {shown &&
        ('error' in shown ? (
          <Note refused text={shown.error} />
        ) : (
          <Note text={format(w.sent, { email: shown.sent })} />
        ))}
    </form>
  )
}
