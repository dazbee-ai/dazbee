// The admin pages' overview, served at the pilot host's `/` (pilot.dazbee.com, or PILOT_HOST for a local run)
// and not found on any other host. It needs Dazbee's own sign-in, and is not found for anyone the API doesn't
// take for an admin. It holds AI's figures and charts over the days the address names, and early access's
// counts, each leading to its page.
import { headers } from 'next/headers'
import { notFound, redirect } from 'next/navigation'

import { StatTile } from '@/components/charts/stat-tile.tsx'
import { AdminShell } from '@/components/pilot/admin-shell.tsx'
import { AiRange } from '@/components/pilot/ai-costs.tsx'
import { AiOverview } from '@/components/pilot/ai-overview.tsx'
import { daysOf, one, utcToday } from '@/lib/admin-days.ts'
import { getMessages } from '@/lib/i18n/server.ts'
import { isPilotHost } from '@/lib/pilot-host.ts'
import { findAdminPage } from '@/lib/server/admin.ts'
import { findAiOverview } from '@/lib/server/admin-ai.ts'
import { findMe } from '@/lib/server/api.ts'

export const dynamic = 'force-dynamic'

/** What the address may say: the days shown; a setting given twice is an array. */
type Query = Promise<Record<'from' | 'to', string | string[] | undefined>>

/** The page's title, only where the page is found: elsewhere the title is the not-found page's. */
export async function generateMetadata({ searchParams }: { searchParams: Query }) {
  if (!isPilotHost((await headers()).get('host')) || !(await findMe())) return {}
  const query = await searchParams
  const { from, to } = daysOf({ from: one(query.from), to: one(query.to) })
  if (!(await findAdminPage()) || !(await findAiOverview(from, to, utcToday()))) return {}
  const t = await getMessages()
  return { title: `${t.pilotAdmin.pages.overview} · ${t.pilotAdmin.name} · Dazbee` }
}

export default async function PilotOverviewPage({ searchParams }: { searchParams: Query }) {
  if (!isPilotHost((await headers()).get('host'))) notFound()
  if (!(await findMe())) redirect('/login')
  const query = await searchParams
  const { from, to, refused } = daysOf({ from: one(query.from), to: one(query.to) })
  const today = utcToday()
  const [t, access, ai] = await Promise.all([getMessages(), findAdminPage(), findAiOverview(from, to, today)])
  if (!access || !ai) notFound()
  const w = t.pilotAdmin.tiles
  const counts = [
    { key: 'waiting', label: w.waiting, value: access.requests.length },
    { key: 'pending', label: w.pending, value: access.invites.pending.length },
    { key: 'joined', label: w.joined, value: access.invites.joined.length },
  ]
  return (
    <AdminShell
      page="overview"
      t={t}
      title={t.pilotAdmin.pages.overview}
      controls={<AiRange from={from} to={to} today={today} refused={refused} keep={{}} />}
    >
      <AiOverview
        settings={ai.settings}
        costs={ai.costs}
        today={ai.today}
        checks={ai.checks}
        unknownCalls={ai.unknownCalls}
        outOfMoney={ai.outOfMoney}
        from={from}
        to={to}
      />
      <section aria-labelledby="overview-access-title" className="flex flex-col gap-3">
        <h2 id="overview-access-title" className="text-body font-semibold">
          {t.pilotAdmin.pages.access}
        </h2>
        <div className="grid grid-cols-3 gap-3 xl:grid-cols-5">
          {counts.map((count) => (
            <StatTile
              key={count.key}
              testId={`tile-${count.key}`}
              label={count.label}
              value={String(count.value)}
              href="/access"
            />
          ))}
        </div>
      </section>
    </AdminShell>
  )
}
