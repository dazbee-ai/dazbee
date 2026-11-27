// The Brands page (ADR-0011, ADR-0013), as in the final mock: a card per brand in its own colours,
// with its latest design and how many it has, and a last card that adds one for a member who may. A
// member limited to some brands sees only theirs, and with none, Daz saying to ask the Owner for one.
import { redirect } from 'next/navigation'

import { addBrand } from '@/app/actions.ts'
import { BrandCard, type BrandCardData } from '@/components/brands/brand-cards.tsx'
import { NewBrandCard } from '@/components/brands/new-brand-card.tsx'
import { LibraryShell } from '@/components/library/library-shell.tsx'
import { EmptyState } from '@/components/ui/empty-state.tsx'
import { brandPath, workspacePath } from '@/lib/brand-routes.ts'
import { hexOf } from '@/lib/colour.ts'
import { designPictureSrc } from '@/lib/design-picture.ts'
import { needsWelcome, openingBrand } from '@/lib/home.ts'
import { brandWords, designCount } from '@/lib/i18n/index.ts'
import { getLocale, getMessages } from '@/lib/i18n/server.ts'
import { designCover, getAccess, getBrandKit, getWorkspace, listBrands, listDesigns } from '@/lib/server/api.ts'
import { canAddBrand } from '@/lib/settings-rights.ts'

export const dynamic = 'force-dynamic'

export default async function HomePage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params
  const [t, locale, workspace, brands, { role, limited }] = await Promise.all([
    getMessages(),
    getLocale(),
    getWorkspace(workspaceId),
    listBrands(workspaceId),
    getAccess(workspaceId),
  ])
  const words = brandWords(t)
  if (needsWelcome(brands, limited)) redirect(workspacePath(workspaceId, 'welcome'))
  const opening = openingBrand(brands)
  if (opening) redirect(brandPath(workspaceId, opening.id))

  const cards: BrandCardData[] = await Promise.all(
    brands.map(async (brand) => {
      const [designs, kit] = await Promise.all([
        listDesigns(workspaceId, brand.id),
        getBrandKit(workspaceId, brand.id).catch(() => null),
      ])
      const latest = designs[0]
      const cover = latest ? await designCover(workspaceId, brand.id, latest.id).catch(() => null) : null
      return {
        ...brand,
        designCount: designs.length,
        colors: (kit?.colors ?? []).map((c) => hexOf(c.value)),
        latest:
          latest && cover
            ? {
                src: designPictureSrc(workspaceId, brand.id, latest, cover),
                width: cover.width,
                height: cover.height,
              }
            : null,
      }
    }),
  )
  const count = (n: number) => designCount(locale, t, n)

  if (brands.length === 0)
    return (
      <LibraryShell t={t} words={words} workspace={workspace} brands={brands} showBrands={false} place="brands">
        <EmptyState
          pose="shrug"
          titleAs="h1"
          title={t.library.noBrands.title}
          line={t.library.noBrands.line}
          className="pt-16 md:pt-24"
        />
      </LibraryShell>
    )

  return (
    <LibraryShell t={t} words={words} workspace={workspace} brands={brands} place="brands">
      <h1 className="font-display text-title font-bold tracking-tight">{words.title}</h1>
      <p className="mt-2 text-muted">{words.lead}</p>
      <ul aria-label={words.title} className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((brand, i) => (
          <li key={brand.id} className="rise min-w-0" style={{ animationDelay: `${Math.min(i, 12) * 40}ms` }}>
            <BrandCard workspaceId={workspaceId} brand={brand} count={count(brand.designCount)} />
          </li>
        ))}
        {canAddBrand(role, limited) && (
          <li className="rise min-w-0" style={{ animationDelay: `${Math.min(cards.length, 12) * 40}ms` }}>
            <NewBrandCard
              action={addBrand.bind(null, workspaceId)}
              words={{
                add: words.add,
                start: t.library.start,
                placeholder: t.library.startPlaceholder,
                callIt: t.library.callIt,
                change: t.library.change,
                name: words.name,
                create: t.library.create,
                cancel: t.library.cancel,
              }}
            />
          </li>
        )}
      </ul>
    </LibraryShell>
  )
}
