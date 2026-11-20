// A brand's home (#84): "What are we making today?" as a brief, followed by sizes to start blank
// in or a template. The brand's designs, templates and kit are pages of their own, from the
// capsule. Right after the brand is made, Daz says it is ready above the brief, once. A Reviewer,
// who makes nothing, gets Daz and a way to the brand's designs instead.
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'

import { BrandMade } from '@/components/brands/brand-made.tsx'
import { BriefComposer } from '@/components/brief/brief-composer.tsx'
import { StartBlank } from '@/components/brief/start-blank.tsx'
import { LibraryShell } from '@/components/library/library-shell.tsx'
import { buttonStyles } from '@/components/ui/button.tsx'
import { EmptyState } from '@/components/ui/empty-state.tsx'
import { brandPath } from '@/lib/brand-routes.ts'
import { justMade } from '@/lib/brand-start.ts'
import { briefDesign, type BriefSize } from '@/lib/brief.ts'
import { brandPage, showsBrandList } from '@/lib/home.ts'
import { brandWords, format } from '@/lib/i18n/index.ts'
import { getMessages } from '@/lib/i18n/server.ts'
import {
  createDesign,
  designCover,
  getBrandKit,
  getRole,
  getWorkspace,
  listBrands,
  listDesigns,
} from '@/lib/server/api.ts'
import { canChange } from '@/lib/settings-rights.ts'

export const dynamic = 'force-dynamic'

/** How many designs the brief offers as a reference ad: the most recently changed. */
const REFERENCES = 24

export default async function BrandPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string; brandId: string }>
  searchParams: Promise<{ show?: string; made?: string }>
}) {
  const [{ workspaceId, brandId }, { show, made }] = await Promise.all([params, searchParams])
  // The panels these pages replaced were linked as ?show=recent, ?show=templates and ?show=kit.
  const moved = brandPage(show)
  if (moved) redirect(brandPath(workspaceId, brandId, moved))
  const [t, workspace, brands, role] = await Promise.all([
    getMessages(),
    getWorkspace(workspaceId),
    listBrands(workspaceId),
    getRole(workspaceId),
  ])
  const brand = brands.find((c) => c.id === brandId)
  if (!brand) notFound()
  const shell = {
    t,
    words: brandWords(t),
    workspace,
    brands,
    activeBrandId: brand.id,
    showBrands: showsBrandList(brands),
  }
  if (!canChange(role)) {
    const words = t.library.review.home
    return (
      <LibraryShell {...shell}>
        <div className="pt-[8vh] md:pt-[14vh]">
          <EmptyState
            pose="hello"
            titleAs="h1"
            title={format(words.title, { brand: brand.name })}
            line={words.line}
            action={
              <Link
                href={brandPath(workspaceId, brand.id, 'designs')}
                className={buttonStyles({ variant: 'primary', size: 'lg' })}
              >
                {words.action}
              </Link>
            }
          />
        </div>
      </LibraryShell>
    )
  }
  const [designs, kit] = await Promise.all([listDesigns(workspaceId, brand.id), getBrandKit(workspaceId, brand.id)])
  const references = await Promise.all(
    designs.slice(0, REFERENCES).map(async ({ id, name, updatedAt }) => {
      // Only the sizes here: each picture is drawn when the browser asks for it, not before the page comes.
      const cover = await designCover(workspaceId, brand.id, id).catch(() => null)
      return { id, name, updatedAt, cover }
    }),
  )
  const untitled = t.library.untitled
  const presetName = t.editor.sizes.preset

  async function make(form: FormData) {
    'use server'
    const brief = String(form.get('brief') ?? '').trim()
    const firstLine = brief.split('\n')[0]?.trim() ?? ''
    const name = (firstLine.length > 60 ? `${firstLine.slice(0, 59).trimEnd()}…` : firstLine) || untitled
    const sizes = form.getAll('size').map(String)
    const design = await createDesign(
      workspaceId,
      brandId,
      name,
      briefDesign(name, sizes, (id) => presetName[id]),
    )
    redirect(brandPath(workspaceId, brandId, 'designs', design.id))
  }

  /** A design of one empty frame in one size, named Untitled design. */
  async function startBlank(sizeId: BriefSize) {
    'use server'
    const design = await createDesign(
      workspaceId,
      brandId,
      untitled,
      briefDesign(untitled, [sizeId], (id) => presetName[id]),
    )
    redirect(brandPath(workspaceId, brandId, 'designs', design.id))
  }

  return (
    <LibraryShell {...shell}>
      <div className="pt-[8vh] md:pt-[14vh]">
        {justMade(made) && <BrandMade brandName={brand.name} />}
        <BriefComposer
          t={t}
          workspaceId={workspaceId}
          brandId={brand.id}
          brandName={brand.name}
          kit={kit}
          references={references}
          action={make}
        />
        <StartBlank t={t} workspaceId={workspaceId} brandId={brand.id} start={startBlank} />
      </div>
    </LibraryShell>
  )
}
