// Settings, in two parts as the final mock's settings: a bold title, then each part in a panel. You
// holds the person's own settings and workspaces, each but the one they own with Leave, and Delete account,
// which names what deleting would delete; This workspace
// holds its name, which only an Owner or Admin can change, and its members, whose roles and brands only an
// Owner or Admin changes. An Owner or Admin also sees Invite, whose brands start at the brand Settings was
// opened from (`?brand=`), and the pending invites. Last, everyone sees Agents: the accesses they gave agents in
// this workspace, each to end, and how to connect one at the MCP server's address. At the foot, a link to the
// third-party notices.
import { headers } from 'next/headers'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { LibraryShell } from '@/components/library/library-shell.tsx'
import { AgentsPanel } from '@/components/settings/agents-panel.tsx'
import { InviteForm } from '@/components/settings/invite-form.tsx'
import { MembersPanel } from '@/components/settings/members-panel.tsx'
import { PendingInvites } from '@/components/settings/pending-invites.tsx'
import { YouPanel } from '@/components/settings/you-panel.tsx'
import { buttonStyles } from '@/components/ui/button.tsx'
import { CheckIcon } from '@/components/ui/icons.tsx'
import { workspacePath } from '@/lib/brand-routes.ts'
import { cn } from '@/lib/cn.ts'
import { showsBrandList } from '@/lib/home.ts'
import { brandWords, type Messages } from '@/lib/i18n/index.ts'
import { getMessages } from '@/lib/i18n/server.ts'
import { mcpAddress } from '@/lib/mcp-address.ts'
import { getAccountDeletion } from '@/lib/server/account.ts'
import { listAgentAccesses } from '@/lib/server/agents.ts'
import { getAccess, getMe, getWorkspace, listBrands, updateWorkspace } from '@/lib/server/api.ts'
import { listInvites, listMembers } from '@/lib/server/members.ts'
import { canInvite, canRenameWorkspace } from '@/lib/settings-rights.ts'

export const dynamic = 'force-dynamic'

export default async function SettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>
  searchParams: Promise<{ saved?: string; brand?: string }>
}) {
  const [{ workspaceId }, { saved, brand }] = await Promise.all([params, searchParams])
  const accessRead = getAccess(workspaceId)
  const [t, workspace, brands, me, { role, limited }, members, invites, deletion, accesses, requestHeaders] =
    await Promise.all([
      getMessages(),
      getWorkspace(workspaceId),
      listBrands(workspaceId),
      getMe(),
      accessRead,
      listMembers(workspaceId),
      // Only an Owner or Admin reads the pending invites: their links let anyone in.
      accessRead.then(({ role }) => (canInvite(role) ? listInvites(workspaceId) : null)),
      getAccountDeletion(),
      listAgentAccesses(workspaceId),
      headers(),
    ])
  const here = workspacePath(workspaceId, 'settings')

  async function rename(form: FormData) {
    'use server'
    const name = String(form.get('name') ?? '').trim()
    // A name of spaces only is no name: nothing is saved, and nothing says it was.
    if (!name) redirect(here)
    await updateWorkspace(workspaceId, { name: name.slice(0, 120) })
    redirect(`${here}?saved=name`)
  }

  return (
    <LibraryShell
      t={t}
      words={brandWords(t)}
      workspace={workspace}
      brands={brands}
      showBrands={showsBrandList(brands)}
      place="settings"
    >
      <div className="mx-auto max-w-5xl pt-2 md:pt-4">
        <h1 className="font-display text-title font-bold tracking-tight md:leading-tight">{t.settings.title}</h1>
        <div className="mt-6 flex flex-col gap-4 md:mt-8 md:gap-6">
          <YouPanel t={t} workspaces={me.workspaces} currentId={workspaceId} email={me.email} deletion={deletion} />
          <section
            aria-labelledby="workspace-title"
            data-testid="workspace-panel"
            className="rounded-[20px] border border-line bg-surface p-5 shadow-panel md:p-7"
          >
            <h2 id="workspace-title" className="font-display text-heading font-bold tracking-tight md:leading-tight">
              {t.settings.thisWorkspace}
            </h2>
            {canRenameWorkspace(role) ? (
              <RenameForm t={t} name={workspace.name} saved={saved === 'name'} action={rename} />
            ) : (
              <div className="mt-5 flex flex-col gap-2">
                <span className="text-label font-medium">{t.settings.workspaceName}</span>
                <p className="text-card" data-testid="workspace-name">
                  {workspace.name}
                </p>
              </div>
            )}
            <MembersPanel
              workspaceId={workspaceId}
              members={members}
              brands={brands}
              viewerId={me.id}
              viewerRole={role}
              viewerLimited={limited}
            />
            {invites && (
              <>
                <InviteForm
                  workspaceId={workspaceId}
                  brands={brands}
                  fromBrand={brands.find((each) => each.id === brand)?.id}
                />
                <PendingInvites workspaceId={workspaceId} invites={invites} brands={brands} />
              </>
            )}
            <AgentsPanel
              workspaceId={workspaceId}
              accesses={accesses}
              brands={brands}
              address={mcpAddress(requestHeaders)}
            />
          </section>
        </div>
        <p className="mt-6 text-label text-muted md:mt-8">
          <Link href="/notices" className="rounded-row hover:text-text hover:underline">
            {t.settings.notices}
          </Link>
        </p>
      </div>
    </LibraryShell>
  )
}

/** This workspace's name as a field, saved with Save, for an Owner or Admin. */
function RenameForm({
  t,
  name,
  saved,
  action,
}: {
  t: Messages
  name: string
  /** Whether the name was just saved, so the note says so. */
  saved: boolean
  action: (form: FormData) => Promise<void>
}) {
  return (
    <form action={action} className="mt-5 flex flex-col gap-2">
      <label htmlFor="workspace-name" className="text-label font-medium">
        {t.settings.workspaceName}
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <input
          id="workspace-name"
          name="name"
          required
          maxLength={120}
          defaultValue={name}
          autoComplete="organization"
          className="h-11 min-w-0 flex-1 basis-64 rounded-row border border-line bg-bg px-3 text-card outline-none hover:border-line-strong focus:border-accent"
        />
        <button
          type="submit"
          className={cn(buttonStyles({ variant: 'primary', size: 'lg' }), 'h-11 px-7 font-semibold')}
        >
          {t.settings.save}
        </button>
        {saved && <Saved label={t.settings.saved} />}
      </div>
    </form>
  )
}

/** A short note that a section's change was saved. */
function Saved({ label }: { label: string }) {
  return (
    <span role="status" className="inline-flex items-center gap-1.5 text-label text-muted">
      <CheckIcon size={16} weight="bold" aria-hidden className="text-success" />
      {label}
    </span>
  )
}
