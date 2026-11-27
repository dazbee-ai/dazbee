// A brand's designs (Recent in the capsule), as the earlier mock's masonry page: the brand's name
// with chips that filter by the cover frame's shape, then every design in its own shape. A Reviewer's
// tiles have no menu, and their empty page offers nothing to make.
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { shapeOf } from '@dazbee/schema'

import {
  deleteDesignAction,
  duplicateDesignAction,
  renameDesignAction,
} from '@/app/w/[workspaceId]/brands/[brandId]/actions.ts'
import { DesignMasonry, type MasonryDesign } from '@/components/library/design-masonry.tsx'
import { FilterChips } from '@/components/library/filter-chips.tsx'
import { LibraryShell } from '@/components/library/library-shell.tsx'
import { buttonStyles } from '@/components/ui/button.tsx'
import { EmptyState } from '@/components/ui/empty-state.tsx'
import { brandPath } from '@/lib/brand-routes.ts'
import { showsBrandList } from '@/lib/home.ts'
import { brandWords, designCount, format } from '@/lib/i18n/index.ts'
import { getLocale, getMessages } from '@/lib/i18n/server.ts'
import { designsWorking } from '@/lib/server/ai-flow.ts'
import { designCover, getRole, getWorkspace, listBrands, listDesigns } from '@/lib/server/api.ts'
import { canChange } from '@/lib/settings-rights.ts'

export const dynamic = 'force-dynamic'

const SHAPES = ['square', 'portrait', 'story', 'landscape'] as const
type Shape = (typeof SHAPES)[number]

/** Which chip a picture's size falls under: a story is tall, landscape takes wide too. */
function chipOf(size: { width: number; height: number } | null): Shape | null {
  if (!size) return null
  const shape = shapeOf(size.width, size.height)
  return shape === 'tall' ? 'story' : shape === 'wide' ? 'landscape' : shape
}

export default async function DesignsPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string; brandId: string }>
  searchParams: Promise<{ shape?: string }>
}) {
  const [{ workspaceId, brandId }, { shape }] = await Promise.all([params, searchParams])
  const [t, locale, workspace, brands, role] = await Promise.all([
    getMessages(),
    getLocale(),
    getWorkspace(workspaceId),
    listBrands(workspaceId),
    getRole(workspaceId),
  ])
  const brand = brands.find((b) => b.id === brandId)
  if (!brand) notFound()
  const changes = canChange(role)
  // The brand's designs with AI work on them, in one read; a Reviewer, who can't use AI, sees none.
  const [summaries, working] = await Promise.all([
    listDesigns(workspaceId, brand.id),
    changes ? designsWorking(workspaceId, brand.id).catch(() => []) : [],
  ])
  // Only the sizes here: each picture is drawn when the browser asks for it, not before the page comes.
  const designs: MasonryDesign[] = await Promise.all(
    summaries.map(async (design) => ({
      ...design,
      cover: await designCover(workspaceId, brand.id, design.id).catch(() => null),
    })),
  )
  const picked = SHAPES.find((s) => s === shape) ?? null
  const shown = picked ? designs.filter((d) => chipOf(d.cover) === picked) : designs
  const here = brandPath(workspaceId, brand.id, 'designs')
  const l = t.library

  return (
    <LibraryShell
      t={t}
      words={brandWords(t)}
      workspace={workspace}
      brands={brands}
      activeBrandId={brand.id}
      showBrands={showsBrandList(brands)}
      place="designs"
    >
      <div className="flex flex-col gap-6 pt-2 md:pt-4">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h1 className="font-display text-title font-bold tracking-tight md:leading-tight">{t.home.recent}</h1>
          <span className="text-label font-medium text-muted tabular-nums">
            {designCount(locale, t, designs.length)}
          </span>
        </div>
        {designs.length > 0 && (
          <FilterChips
            label={l.filters}
            chips={[
              { label: format(l.filterAll, { n: designs.length }), href: here, on: picked === null },
              ...SHAPES.map((s) => ({ label: l.shapes[s], href: `${here}?shape=${s}`, on: picked === s })),
            ]}
          />
        )}
        {designs.length === 0 ? (
          <EmptyState
            pose="create"
            title={l.emptyRecent.title}
            line={changes ? l.emptyRecent.line : l.review.emptyRecent}
            action={
              changes && (
                <Link
                  href={brandPath(workspaceId, brand.id, 'templates')}
                  className={buttonStyles({ variant: 'primary', size: 'lg' })}
                >
                  {l.emptyRecent.action}
                </Link>
              )
            }
          />
        ) : shown.length === 0 ? (
          <EmptyState pose="shrug" size={96} title={l.noShape.title} line={l.noShape.line} />
        ) : (
          <DesignMasonry
            t={t}
            locale={locale}
            workspaceId={workspaceId}
            brandId={brand.id}
            designs={shown}
            working={Object.fromEntries(working.map((w) => [w.designId, w.work]))}
            {...(changes && {
              actions: {
                rename: renameDesignAction.bind(null, workspaceId, brand.id),
                duplicate: duplicateDesignAction.bind(null, workspaceId, brand.id),
                remove: deleteDesignAction.bind(null, workspaceId, brand.id),
              },
            })}
          />
        )}
      </div>
    </LibraryShell>
  )
}
