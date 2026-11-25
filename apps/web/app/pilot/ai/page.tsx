// The admin page's AI section, served at the pilot host's `/ai` and not found on any other host. It needs
// Dazbee's own sign-in, and is not found for anyone the API doesn't take for an admin. It holds the settings
// and today's spend, the costs, the daily check, gifts and grants, each AI step's model, the price list and
// the seller order. The days the costs and the daily check cover, the workspace search and the open workspace
// are in the address.
import { headers } from 'next/headers'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'

import { AiCosts, AiRange } from '@/components/pilot/ai-costs.tsx'
import { AiDailyCheck } from '@/components/pilot/ai-daily-check.tsx'
import { AiGrants } from '@/components/pilot/ai-grants.tsx'
import { AiPriceList } from '@/components/pilot/ai-price-list.tsx'
import { AiSellerOrder } from '@/components/pilot/ai-seller-order.tsx'
import { AiSettings } from '@/components/pilot/ai-settings.tsx'
import { AiStepModels } from '@/components/pilot/ai-step-models.tsx'
import { DazbeeMark } from '@/components/ui/dazbee-mark.tsx'
import { daysOf, one, pick } from '@/lib/admin-days.ts'
import { getMessages } from '@/lib/i18n/server.ts'
import { isPilotHost } from '@/lib/pilot-host.ts'
import { findAiPage, findAiWorkspaces, findAllowance } from '@/lib/server/admin-ai.ts'
import { findMe } from '@/lib/server/api.ts'

export const dynamic = 'force-dynamic'

/** What the address may say: the days, the search, and the open workspace; a setting given twice is an array. */
type Query = Promise<Record<'from' | 'to' | 'q' | 'workspace', string | string[] | undefined>>

const PANEL = 'flex flex-col gap-6 rounded-[20px] border border-line bg-surface p-5 shadow-panel md:p-7'

/** The page's title, only where the page is found: elsewhere the title is the not-found page's. */
export async function generateMetadata({ searchParams }: { searchParams: Query }) {
  if (!isPilotHost((await headers()).get('host')) || !(await findMe())) return {}
  const query = await searchParams
  const { from, to } = daysOf({ from: one(query.from), to: one(query.to) })
  if (!(await findAiPage(from, to))) return {}
  const t = await getMessages()
  return { title: `${t.pilotAi.title} · ${t.pilot.title} · Dazbee` }
}

export default async function PilotAiPage({ searchParams }: { searchParams: Query }) {
  if (!isPilotHost((await headers()).get('host'))) notFound()
  if (!(await findMe())) redirect('/login')
  const query = Object.fromEntries(Object.entries(await searchParams).map(([k, v]) => [k, one(v)])) as Record<
    'from' | 'to' | 'q' | 'workspace',
    string | undefined
  >
  const { from, to, refused } = daysOf(query)
  const [t, page] = await Promise.all([getMessages(), findAiPage(from, to)])
  if (!page) notFound()
  const search = (query.q ?? '').trim()
  const [found, allowance] = await Promise.all([
    search.length >= 2 ? findAiWorkspaces(search.slice(0, 200)) : null,
    query.workspace ? findAllowance(query.workspace) : null,
  ])
  const days = { from, to }
  return (
    <main className="min-h-dvh bg-bg px-4 py-8 text-text md:px-8 md:py-12">
      <div className="mx-auto flex max-w-5xl flex-col gap-6">
        <header className="flex flex-col gap-3">
          <DazbeeMark size={36} />
          <Link href="/" className="self-start text-label text-muted hover:text-text">
            {t.pilotAi.back}
          </Link>
          <h1 className="font-display text-title font-bold tracking-tight md:leading-tight">{t.pilotAi.title}</h1>
          <p className="text-label text-muted">{t.pilotAi.lead}</p>
        </header>
        <section className={PANEL}>
          <AiSettings settings={page.settings} />
        </section>
        <section className={PANEL}>
          <AiRange from={from} to={to} refused={refused} keep={pick({ q: query.q, workspace: query.workspace })} />
          <AiCosts costs={page.costs} />
        </section>
        <section className={PANEL}>
          <AiDailyCheck
            checks={page.checks}
            lastChecked={page.lastChecked}
            unknownCalls={page.unknownCalls}
            outOfMoney={page.outOfMoney}
          />
        </section>
        <section className={PANEL}>
          <AiGrants query={search} found={found} allowance={allowance} keep={days} />
        </section>
        <section className={PANEL}>
          <AiStepModels steps={page.stepModels} />
        </section>
        <section className={PANEL}>
          <AiPriceList rates={page.rates} prices={page.prices} />
        </section>
        <section className={PANEL}>
          <AiSellerOrder models={page.modelSellers} />
        </section>
      </div>
    </main>
  )
}
