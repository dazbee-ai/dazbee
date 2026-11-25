// Early access's admin page, served at the pilot host's `/access` (pilot.dazbee.com, or PILOT_HOST for a
// local run) and not found on any other host. It needs Dazbee's own sign-in, and is not found for anyone the
// API doesn't take for an admin. It holds Invite, the Waiting list, the Pending invites and the people who
// Joined.
import { headers } from 'next/headers'
import { notFound, redirect } from 'next/navigation'

import { AdminShell, CARD } from '@/components/pilot/admin-shell.tsx'
import { PilotInviteForm } from '@/components/pilot/pilot-invite-form.tsx'
import { JoinedPeople, PendingDazbeeInvites } from '@/components/pilot/pilot-invites.tsx'
import { WaitingList } from '@/components/pilot/waiting-list.tsx'
import { getMessages } from '@/lib/i18n/server.ts'
import { isPilotHost } from '@/lib/pilot-host.ts'
import { findAdminPage } from '@/lib/server/admin.ts'
import { findMe } from '@/lib/server/api.ts'

export const dynamic = 'force-dynamic'

/** The page's title, only where the page is found: elsewhere the title is the not-found page's. */
export async function generateMetadata() {
  if (!isPilotHost((await headers()).get('host')) || !(await findMe()) || !(await findAdminPage())) return {}
  const t = await getMessages()
  return { title: `${t.pilot.title} · ${t.pilotAdmin.name} · Dazbee` }
}

export default async function PilotAccessPage() {
  if (!isPilotHost((await headers()).get('host'))) notFound()
  if (!(await findMe())) redirect('/login')
  const [t, page] = await Promise.all([getMessages(), findAdminPage()])
  if (!page) notFound()
  return (
    <AdminShell page="access" t={t} title={t.pilot.title} lead={t.pilot.lead}>
      <section className={CARD}>
        <PilotInviteForm />
      </section>
      <div className="grid min-w-0 gap-5 xl:grid-cols-2">
        <section className={CARD}>
          <WaitingList requests={page.requests} />
        </section>
        <section className={`${CARD} gap-6`}>
          <PendingDazbeeInvites invites={page.invites.pending} />
          <JoinedPeople people={page.invites.joined} />
        </section>
      </div>
    </AdminShell>
  )
}
