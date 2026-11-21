// A brand's kit (#53, #200), as the earlier mock's Brand kit page: the brand's name over the kit's
// whole form laid out wide (colours, fonts, logo and voice, each change saved as it is made), then
// the brand's latest designs, where the kit is used. A Reviewer sees the kit with nothing to change.
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { kitIsEmpty } from '@/components/brand-kit/kit-empty.ts'
import { KitPage } from '@/components/brand-kit/kit-page.tsx'
import { KitUnreadable } from '@/components/brand-kit/kit-unreadable.tsx'
import { KitView } from '@/components/brand-kit/kit-view.tsx'
import { LibraryShell } from '@/components/library/library-shell.tsx'
import { EmptyState } from '@/components/ui/empty-state.tsx'
import { brandPath } from '@/lib/brand-routes.ts'
import { showsBrandList } from '@/lib/home.ts'
import { brandWords, format } from '@/lib/i18n/index.ts'
import { getMessages } from '@/lib/i18n/server.ts'
import { designCover, getBrandKit, getRole, getWorkspace, listBrands, listDesigns } from '@/lib/server/api.ts'
import { canChange } from '@/lib/settings-rights.ts'

export const dynamic = 'force-dynamic'

/** How many of the latest designs show under the kit. */
const LATEST = 6

export default async function BrandKitPage({ params }: { params: Promise<{ workspaceId: string; brandId: string }> }) {
  const { workspaceId, brandId } = await params
  const [t, workspace, brands, role] = await Promise.all([
    getMessages(),
    getWorkspace(workspaceId),
    listBrands(workspaceId),
    getRole(workspaceId),
  ])
  const brand = brands.find((b) => b.id === brandId)
  if (!brand) notFound()
  const changes = canChange(role)
  const [kit, designs] = await Promise.all([getBrandKit(workspaceId, brand.id), listDesigns(workspaceId, brand.id)])
  const latest = (
    await Promise.all(
      designs.slice(0, LATEST).map(async (design) => ({
        ...design,
        cover: await designCover(workspaceId, brand.id, design.id).catch(() => null),
      })),
    )
  ).filter((design) => design.cover)

  return (
    <LibraryShell
      t={t}
      words={brandWords(t)}
      workspace={workspace}
      brands={brands}
      activeBrandId={brand.id}
      showBrands={showsBrandList(brands)}
      place="kit"
    >
      <div className="flex flex-col gap-6 pt-2 md:pt-4">
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <h1 className="font-display text-title font-bold tracking-tight md:leading-tight">{t.home.brandKit}</h1>
            <span className="text-label font-medium text-muted">{brand.name}</span>
          </div>
          {changes && <p className="text-label text-muted">{format(t.home.kit.panelLead, { brand: brand.name })}</p>}
        </div>
        {changes ? (
          <KitPage workspaceId={workspaceId} brandId={brand.id} kit={kit} />
        ) : !kit ? (
          <KitUnreadable brandId={brand.id} />
        ) : kitIsEmpty(kit) ? (
          <EmptyState pose="palette" title={t.library.emptyKit.title} line={t.library.review.emptyKit} />
        ) : (
          <KitView t={t} workspaceId={workspaceId} brandId={brand.id} kit={kit} />
        )}
        {latest.length > 0 && (
          <section aria-labelledby="kit-latest" className="flex flex-col gap-3">
            <h2 id="kit-latest" className="text-caption font-bold tracking-[0.08em] text-subtle uppercase">
              {t.library.latest}
            </h2>
            <ul className="flex gap-3 overflow-x-auto pb-1">
              {latest.map((design) => (
                <li key={design.id} className="shrink-0">
                  <Link
                    href={brandPath(workspaceId, brand.id, 'designs', design.id)}
                    prefetch={false}
                    title={design.name}
                    className="lift block h-28 overflow-hidden rounded-[12px] bg-raised shadow-panel"
                  >
                    <img
                      src={`${brandPath(workspaceId, brand.id, 'designs', design.id, 'thumbnail')}?v=${Date.parse(design.updatedAt)}`}
                      alt={design.name}
                      width={design.cover?.width}
                      height={design.cover?.height}
                      className="h-full w-auto object-cover"
                    />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </LibraryShell>
  )
}
