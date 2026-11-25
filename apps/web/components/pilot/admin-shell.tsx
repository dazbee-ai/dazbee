// The admin pages' frame: Dazbee's mark and the pages it moves between, Overview, Early access and AI, in a
// column beside the page on a wide screen and a bar over it on a narrow one; then the page's title, the
// controls that scope it, and its cards.
import Link from 'next/link'
import type { ReactNode } from 'react'

import { DazbeeMark } from '@/components/ui/dazbee-mark.tsx'
import { type Icon, SparkleIcon, SquaresFourIcon, UsersIcon } from '@/components/ui/icons.tsx'
import { FOCUS_RING } from '@/components/ui/looks.ts'
import { cn } from '@/lib/cn.ts'
import type { Messages } from '@/lib/i18n/en.ts'

/** An admin page, by what it holds. */
export type AdminPage = 'overview' | 'access' | 'ai'

/** A card on an admin page: a section of it, on the surface. */
export const CARD = 'flex min-w-0 flex-col gap-4 rounded-card border border-line bg-surface p-4 shadow-panel md:p-5'

/** The admin pages in the order the frame lists them, each with its address on the pilot host and its icon. */
const PAGES: { page: AdminPage; href: string; icon: Icon }[] = [
  { page: 'overview', href: '/', icon: SquaresFourIcon },
  { page: 'access', href: '/access', icon: UsersIcon },
  { page: 'ai', href: '/ai', icon: SparkleIcon },
]

export function AdminShell({
  page,
  t,
  title,
  lead,
  controls,
  children,
}: {
  page: AdminPage
  t: Messages
  title: string
  /** A line under the title saying what the page is for. */
  lead?: string
  /** What scopes everything under it, such as the days shown. */
  controls?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="min-h-dvh bg-bg text-text lg:grid lg:grid-cols-[13.5rem_minmax(0,1fr)]">
      <header className="sticky top-0 z-20 border-b border-line bg-surface lg:h-dvh lg:border-e lg:border-b-0">
        <div className="flex items-center gap-2.5 px-4 pt-3 lg:px-5 lg:pt-6 lg:pb-3">
          <DazbeeMark size={28} />
          <span className="font-display text-body font-bold">{t.app.name}</span>
          <span className="rounded-full border border-line px-2 py-0.5 text-micro font-medium text-muted">
            {t.pilotAdmin.name}
          </span>
        </div>
        <nav aria-label={t.pilotAdmin.nav} className="px-2 py-2 lg:px-3">
          <ul className="flex gap-1 lg:flex-col">
            {PAGES.map(({ page: each, href, icon: PageIcon }) => (
              <li key={each}>
                <Link
                  href={href}
                  data-page={each}
                  aria-current={each === page ? 'page' : undefined}
                  className={cn(
                    'flex h-9 items-center gap-2.5 rounded-row px-3 text-small font-medium whitespace-nowrap transition-colors duration-[var(--chrome-fast)] max-sm:h-11',
                    FOCUS_RING,
                    each === page ? 'bg-accent-soft text-text' : 'text-muted hover:bg-hover hover:text-text',
                  )}
                >
                  <PageIcon size={16} aria-hidden className="shrink-0" />
                  {t.pilotAdmin.pages[each]}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </header>
      <main className="min-w-0 px-4 py-6 md:px-8 lg:py-8">
        <div className="mx-auto flex max-w-[80rem] flex-col gap-5">
          <div className="flex flex-col gap-1">
            <h1 className="font-display text-heading-lg font-bold tracking-tight">{title}</h1>
            {lead && <p className="text-label text-muted">{lead}</p>}
          </div>
          {controls}
          {children}
        </div>
      </main>
    </div>
  )
}
