// Connect an agent: an agent's client sends the person here with its sign-in request (ADR-0019). Signed out, they
// sign in and come back. The page reads the request through the API and offers the person's workspaces, the one
// they used last first, each with the brands they see in it, to the form `ConnectAgent` draws. A request the API
// no longer has, or none, shows that the link has expired. It stands outside a workspace, in the sign-in page's look.
import { redirect } from 'next/navigation'
import type { ReactNode } from 'react'

import { MAX_AGENT_REQUEST_ID } from '@dazbee/schema'

import { ConnectAgent, type ConnectWorkspace } from '@/components/settings/connect-agent.tsx'
import { EmptyState } from '@/components/ui/empty-state.tsx'
import { getMessages } from '@/lib/i18n/server.ts'
import { findAgentRequest } from '@/lib/server/agents.ts'
import { findMe, listBrands } from '@/lib/server/api.ts'
import { COMES_BACK_TO } from '@/lib/server/sign-in.ts'

export const dynamic = 'force-dynamic'

export async function generateMetadata() {
  return { title: (await getMessages()).connectAgent.title }
}

export default async function ConnectAgentPage({ searchParams }: { searchParams: Promise<{ request?: string }> }) {
  const [t, query] = await Promise.all([getMessages(), searchParams])
  const words = t.connectAgent
  const request = typeof query.request === 'string' ? query.request.slice(0, MAX_AGENT_REQUEST_ID) : ''
  const expired = (
    <Page>
      <EmptyState pose="clock" titleAs="h1" title={words.expiredTitle} line={words.again} />
    </Page>
  )
  if (!request) return expired
  const me = await findMe()
  if (!me) redirect(`/login?next=${encodeURIComponent(`${COMES_BACK_TO}?${new URLSearchParams({ request })}`)}`)
  const found = await findAgentRequest(request)
  if (!found) return expired
  if (found.workspaces.length === 0)
    return (
      <Page>
        <EmptyState pose="shrug" titleAs="h1" title={words.noWorkspaceTitle} line={words.noWorkspace} />
      </Page>
    )
  const ordered = [...found.workspaces].sort((a, b) => Number(b.id === me.open) - Number(a.id === me.open))
  const workspaces: ConnectWorkspace[] = await Promise.all(
    ordered.map(async ({ id, name, role }) => ({ id, name, role, brands: await listBrands(id) })),
  )
  return (
    <Page>
      <ConnectAgent
        request={request}
        clientName={found.clientName}
        redirectHost={found.redirectHost}
        workspaces={workspaces}
      />
    </Page>
  )
}

/** The page round what it shows: dark, as sign-in is, with what it shows centred. */
function Page({ children }: { children: ReactNode }) {
  return (
    <main data-theme="dark" className="grid min-h-dvh place-items-center bg-bg px-4 py-10 text-text sm:px-6">
      {children}
    </main>
  )
}
