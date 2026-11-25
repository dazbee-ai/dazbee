// Early access's admin page, served at the pilot host's `/` (pilot.dazbee.com, or PILOT_HOST for a local
// run) and not found on any other host. It needs Dazbee's own sign-in, and is not found for anyone the API
// doesn't take for an admin. It holds Invite, the Waiting list, the Pending invites and the people who Joined,
// and links to its AI section at `/ai`.
import { headers } from 'next/headers'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'

import { PilotInviteForm } from '@/components/pilot/pilot-invite-form.tsx'
import { JoinedPeople, PendingDazbeeInvites } from '@/components/pilot/pilot-invites.tsx'
import { WaitingList } from '@/components/pilot/waiting-list.tsx'
import { DazbeeMark } from '@/components/ui/dazbee-mark.tsx'
import { getMessages } from '@/lib/i18n/server.ts'
import { isPilotHost } from '@/lib/pilot-host.ts'
import { findAdminPage } from '@/lib/server/admin.ts'
import { findMe } from '@/lib/server/api.ts'

export const dynamic = 'force-dynamic'

const PANEL = 'flex flex-col gap-6 rounded-[20px] border border-line bg-surface p-5 shadow-panel md:p-7'

/** The page's title, only where the page is found: elsewhere the title is the not-found page's. */
export async function generateMetadata() {
  if (!isPilotHost((await headers()).get('host')) || !(await findMe()) || !(await findAdminPage())) return {}
  return { title: `${(await getMessages()).pilot.title} · Dazbee` }
}

export default async function PilotPage() {
  if (!isPilotHost((await headers()).get('host'))) notFound()
  if (!(await findMe())) redirect('/login')
  const [t, page] = await Promise.all([getMessages(), findAdminPage()])
  if (!page) notFound()
  return (
    <main className="min-h-dvh bg-bg px-4 py-8 text-text md:px-8 md:py-12">
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <header className="flex flex-col gap-3">
          <DazbeeMark size={36} />
          <h1 className="font-display text-title font-bold tracking-tight md:leading-tight">{t.pilot.title}</h1>
          <p className="text-label text-muted">{t.pilot.lead}</p>
          <Link
            href="/ai"
            data-testid="pilot-ai-link"
            className="self-start text-label font-semibold text-accent-text hover:underline"
          >
            {t.pilotAi.open}
          </Link>
        </header>
        <section className={PANEL}>
          <PilotInviteForm />
        </section>
        <section className={PANEL}>
          <WaitingList requests={page.requests} />
        </section>
        <section className={PANEL}>
          <PendingDazbeeInvites invites={page.invites.pending} />
          <JoinedPeople people={page.invites.joined} />
        </section>
      </div>
    </main>
  )
}
