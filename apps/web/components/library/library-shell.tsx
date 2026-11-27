// The app outside the editor, as in the final mock: the editor's top bar (the mark, a crumb whose
// first parts switch workspace and brand, the person's avatar at the end), the same floating capsule
// the editor has (#110). A layout renders the frame with the capsule, so it stays as its pages
// change; each page renders the shell inside it.
import { cookies } from 'next/headers'
import Link from 'next/link'
import type { ReactNode } from 'react'

import type { BrandSummary, WorkspaceSummary } from '@dazbee/schema'

import { addBrand } from '@/app/actions.ts'
import { NewBrandRow } from '@/components/brands/new-brand-row.tsx'
import { AiNote } from '@/components/ui/ai-note.tsx'
import { DazbeeMark } from '@/components/ui/dazbee-mark.tsx'
import { CaretDownIcon, SquaresFourIcon } from '@/components/ui/icons.tsx'
import { brandPath, workspacePath } from '@/lib/brand-routes.ts'
import { cn } from '@/lib/cn.ts'
import { showsWorkspaceList } from '@/lib/home.ts'
import type { BrandWords, Messages } from '@/lib/i18n/index.ts'
import { initialsOf } from '@/lib/initials.ts'
import { getAccess, getMe } from '@/lib/server/api.ts'
import { SESSION_COOKIE } from '@/lib/server/sign-in.ts'
import { canAddBrand } from '@/lib/settings-rights.ts'

import { AccountMenu } from './account-menu.tsx'
import { type CapsuleLink, LibraryCapsule } from './library-capsule.tsx'
import { CRUMB_MENU, WorkspaceSwitcher } from './workspace-switcher.tsx'

/** Where the crumb says you are. */
export type LibraryPlace = 'home' | 'brands' | 'settings' | 'designs' | 'templates' | 'kit'

/** The top bar and page content outside the editor. */
export async function LibraryShell({
  t,
  words,
  workspace,
  brands,
  activeBrandId,
  showBrands = true,
  place = 'home',
  children,
}: {
  t: Messages
  /** The words for the workspace's brands. */
  words: BrandWords
  /** The workspace, for its links, the crumb and the account menu. */
  workspace: WorkspaceSummary
  brands: BrandSummary[]
  activeBrandId?: string
  /** Whether the workspace has brands to switch between; one brand goes without (#84). */
  showBrands?: boolean
  /** The crumb's last part. */
  place?: LibraryPlace
  children: ReactNode
}) {
  const active = brands.find((brand) => brand.id === activeBrandId)
  const { role, limited } = await getAccess(workspace.id)
  const canAdd = canAddBrand(role, limited)
  const placeName = {
    home: t.library.home,
    brands: words.title,
    settings: t.library.settings,
    designs: t.home.recent,
    templates: t.library.templates,
    kit: t.home.brandKit,
  }[place]
  return (
    <>
      <LibraryHeader t={t} workspace={workspace} brandId={active?.id}>
        {/* One brand and nothing to add: the menu would offer only the brand you are on, so it is its name. */}
        {showBrands || canAdd ? (
          (showBrands || active) && (
            <BrandSwitcher
              t={t}
              words={words}
              workspaceId={workspace.id}
              brands={brands}
              active={active}
              showAll={showBrands}
              canAdd={canAdd}
            />
          )
        ) : (
          <span className="max-w-48 min-w-0 shrink-[4] truncate px-1.5 text-muted">{active?.name}</span>
        )}
        {/* On the Brands page the switcher already names it, so the crumb says it once. */}
        {place === 'brands' && !active ? null : (
          <>
            {(showBrands || active) && (
              <span aria-hidden className="text-subtle">
                /
              </span>
            )}
            <span className="min-w-0 truncate px-1.5 font-semibold text-text">{placeName}</span>
          </>
        )}
      </LibraryHeader>

      {/* Room for the capsule at the start, or at the bottom on a phone, only while it shows. */}
      <main className="mx-auto w-full min-w-0 max-w-[110rem] px-4 pb-12 md:px-16 group-data-capsule/library:pb-28 md:group-data-capsule/library:ps-44 md:group-data-capsule/library:pb-12">
        {children}
      </main>
    </>
  )
}

/**
 * What every page outside the editor sits in: the floating capsule over the page, shown only when
 * it holds two or more entries, with the page's room for it only then. A brand's pages have its
 * Home, Recent, Templates and Brand kit; the workspace's pages, the Brands page and Settings, have
 * the Brands page only, so they show no capsule.
 */
export function LibraryFrame({
  t,
  words,
  workspaceId,
  brandId,
  recentCount,
  children,
}: {
  t: Messages
  /** The words for the workspace's brands. */
  words: BrandWords
  workspaceId: string
  /** The brand whose pages these are; none on the workspace's pages. */
  brandId?: string
  /** How many designs the brand has, on the capsule's Recent. */
  recentCount?: number
  children: ReactNode
}) {
  const links: CapsuleLink[] = brandId
    ? [
        { entry: 'home', href: brandPath(workspaceId, brandId), label: t.library.home },
        {
          entry: 'recent',
          href: brandPath(workspaceId, brandId, 'designs'),
          label: t.home.recent,
          badge: recentCount,
        },
        { entry: 'templates', href: brandPath(workspaceId, brandId, 'templates'), label: t.library.templates },
        { entry: 'kit', href: brandPath(workspaceId, brandId, 'kit'), label: t.home.brandKit },
      ]
    : [{ entry: 'home', href: workspacePath(workspaceId), label: words.title }]
  const capsule = links.length > 1
  return (
    <div data-capsule={capsule || undefined} className="group/library relative isolate min-h-dvh overflow-x-clip bg-bg">
      {capsule && <LibraryCapsule label={t.app.name} links={links} />}
      {children}
      <AiNote />
    </div>
  )
}

/**
 * The header of every page outside the editor: the mark at the start, a crumb, and the person's
 * avatar at the end. For a person in two or more workspaces the crumb starts with the workspace's
 * menu. Onboarding uses it too, with no brand to switch to yet.
 */
export async function LibraryHeader({
  t,
  workspace,
  brandId,
  children,
}: {
  t: Messages
  /** The workspace, for the mark's link, the crumb and the account menu. */
  workspace: WorkspaceSummary
  /** The brand whose page it is, which the account menu's Settings names. */
  brandId?: string | undefined
  /** The crumb after the workspace's part. */
  children: ReactNode
}) {
  const [jar, me] = await Promise.all([cookies(), getMe()])
  return (
    <header className="relative z-30 flex h-[4.5rem] items-center gap-2 px-6">
      <Link
        href={workspacePath(workspace.id)}
        aria-label={t.app.name}
        className="grid size-9 shrink-0 place-items-center rounded-row hover:bg-hover"
      >
        <DazbeeMark size={28} />
      </Link>
      <div className="flex min-w-0 items-center gap-1 text-small">
        {showsWorkspaceList(me.workspaces) && (
          <>
            <WorkspaceSwitcher t={t} workspaces={me.workspaces} currentId={workspace.id} />
            <span aria-hidden className="text-subtle">
              /
            </span>
          </>
        )}
        {children}
      </div>
      <span className="ms-auto">
        <AccountMenu
          workspaceId={workspace.id}
          brandId={brandId}
          name={me.name || me.email}
          signedIn={jar.has(SESSION_COOKIE)}
        />
      </span>
    </header>
  )
}

/**
 * The crumb's brand part: the brand you are in, or the word for them all, with a menu of the
 * brands the member sees that ends with New brand for a member who may add one. A <details>, so it opens
 * before any script loads.
 */
function BrandSwitcher({
  t,
  words,
  workspaceId,
  brands,
  active,
  showAll,
  canAdd,
}: {
  t: Messages
  words: BrandWords
  workspaceId: string
  brands: BrandSummary[]
  active: BrandSummary | undefined
  showAll: boolean
  canAdd: boolean
}) {
  return (
    <details name={CRUMB_MENU} className="group relative min-w-0 shrink-[4]" data-testid="brand-switcher">
      <summary
        aria-label={t.home.switchBrand}
        className="flex h-8 min-w-0 cursor-pointer list-none items-center gap-1 rounded-row px-1.5 text-muted transition-colors hover:bg-hover hover:text-text [&::-webkit-details-marker]:hidden"
      >
        <span className="max-w-48 min-w-0 truncate">{active?.name ?? words.title}</span>
        <CaretDownIcon size={12} weight="bold" aria-hidden className="transition-transform group-open:rotate-180" />
      </summary>
      <nav
        aria-label={words.title}
        className="pop-in-start absolute start-0 top-full z-40 mt-2 flex w-64 flex-col gap-0.5 rounded-card surface-frost p-1.5"
      >
        {brands.map((brand) => {
          const current = brand.id === active?.id
          return (
            <Link
              key={brand.id}
              href={brandPath(workspaceId, brand.id)}
              aria-current={current ? 'page' : undefined}
              className={cn(
                'flex h-10 items-center gap-2.5 rounded-row px-2 text-small transition-colors duration-[var(--chrome-fast)]',
                current ? 'bg-hover font-semibold text-text' : 'text-muted hover:bg-hover hover:text-text',
              )}
            >
              <BrandAvatar name={brand.name} active={current} />
              <span className="truncate">{brand.name}</span>
            </Link>
          )
        })}
        {(showAll || canAdd) && <div className="my-1 h-px bg-line" />}
        {showAll && (
          <Link
            href={workspacePath(workspaceId)}
            className="flex h-9 items-center gap-2.5 rounded-row px-2 text-small font-medium text-muted hover:bg-hover hover:text-text"
          >
            <SquaresFourIcon size={16} aria-hidden />
            {words.all}
          </Link>
        )}
        {canAdd && (
          <NewBrandRow
            action={addBrand.bind(null, workspaceId)}
            words={{
              add: words.add,
              start: t.library.start,
              placeholder: t.library.startPlaceholder,
              callIt: t.library.callIt,
              change: t.library.change,
              name: words.name,
              create: t.library.create,
            }}
          />
        )}
      </nav>
    </details>
  )
}

function BrandAvatar({ name, active = false }: { name: string; active?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'grid size-7 shrink-0 place-items-center rounded-[7px] border text-caption font-semibold tracking-wide transition-colors duration-[var(--chrome-fast)]',
        active ? 'border-transparent bg-accent-solid text-on-accent' : 'border-line bg-raised text-muted',
      )}
    >
      {initialsOf(name)}
    </span>
  )
}
