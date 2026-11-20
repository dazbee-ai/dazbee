// Onboarding (#109, ADR-0013): "Paste your website" for the first brand, where an address names it
// and is kept as its website, or a plain name is typed (#203). The app opens here until the
// workspace has a brand. It looks like the final mock's onboarding: the library's top bar, a bold
// headline, and the website in one wide field with its button at the end. Daz says hello above it.
// A Reviewer, who can't add a brand, sees Daz saying there are none yet instead. A member limited to some
// brands never adds one: the Brands page shows them theirs, or says they have none.
import { redirect } from 'next/navigation'

import { BrandStartForm } from '@/components/brands/brand-start-form.tsx'
import { LibraryHeader } from '@/components/library/library-shell.tsx'
import { EmptyState } from '@/components/ui/empty-state.tsx'
import { Mascot } from '@/components/ui/mascot.tsx'
import { workspacePath } from '@/lib/brand-routes.ts'
import { brandFromForm, madeHref } from '@/lib/brand-start.ts'
import { brandWords, type Messages } from '@/lib/i18n/index.ts'
import { getMessages } from '@/lib/i18n/server.ts'
import { createBrand, getAccess, getWorkspace } from '@/lib/server/api.ts'
import { canChange } from '@/lib/settings-rights.ts'

export const dynamic = 'force-dynamic'

const HEADLINE = 'text-center font-display text-display font-bold tracking-tight text-balance md:leading-tight'
const LEAD = 'mx-auto mt-3 max-w-xl text-center text-muted text-balance'

export default async function WelcomePage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>
  searchParams: Promise<{ error?: string }>
}) {
  const [{ workspaceId }, { error }] = await Promise.all([params, searchParams])
  const [t, workspace, { role, limited }] = await Promise.all([
    getMessages(),
    getWorkspace(workspaceId),
    getAccess(workspaceId),
  ])
  if (limited) redirect(workspacePath(workspaceId))
  const w = t.welcome

  async function startBrand(form: FormData) {
    'use server'
    const brand = brandFromForm(form)
    if (!brand) redirect(`${workspacePath(workspaceId, 'welcome')}?error=name`)
    const made = await createBrand(workspaceId, brand.name, brand.website)
    redirect(madeHref(workspaceId, made.id))
  }

  return (
    <div className="relative isolate flex min-h-dvh flex-col overflow-x-clip bg-bg">
      <LibraryHeader t={t} workspace={workspace}>
        <span className="truncate px-1.5 font-semibold text-text">{w.place}</span>
      </LibraryHeader>
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center px-4 pt-4 pb-16 md:px-8 md:pb-24">
        {canChange(role) ? (
          <Welcome t={t} action={startBrand} error={error === 'name' ? w.needName : null} />
        ) : (
          <EmptyState pose="shrug" titleAs="h1" title={w.review.title} line={w.review.line} />
        )}
      </main>
    </div>
  )
}

/** Daz's hello over the website field that adds the first brand. */
function Welcome({
  t,
  action,
  error,
}: {
  t: Messages
  action: (form: FormData) => Promise<void>
  /** What is wrong with the last try, if anything. */
  error: string | null
}) {
  const w = t.welcome
  return (
    <>
      <div className="mb-4 flex flex-col items-center gap-1">
        <Mascot pose="hello" />
        <p className="font-display text-card font-bold text-text">{w.hello}</p>
      </div>
      <h1 className={HEADLINE}>{w.websiteTitle}</h1>
      <p className={LEAD}>{w.websiteLead}</p>
      <BrandStartForm
        action={action}
        words={{
          start: t.library.start,
          placeholder: t.library.startPlaceholder,
          open: w.open,
          callIt: t.library.callIt,
          change: t.library.change,
          name: brandWords(t).name,
        }}
        error={error}
      />
    </>
  )
}
