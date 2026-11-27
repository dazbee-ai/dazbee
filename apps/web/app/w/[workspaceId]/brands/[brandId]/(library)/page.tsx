// A brand's home: "What are we making today?" as a brief, followed by sizes to start blank in or a
// template. Make drafts creates a design holding only the brief's section and four waiting drafts,
// starts the round, and opens the design; a round that doesn't start deletes the design, and the
// brief says why and keeps its fields. The brand's designs, templates and kit are pages of their own, from the
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
import { briefDesign, briefFromForm, type BriefSize, designName } from '@/lib/brief.ts'
import { briefSaid } from '@/lib/editor/brief-box.ts'
import { brandPage, showsBrandList } from '@/lib/home.ts'
import { brandWords, format } from '@/lib/i18n/index.ts'
import { getMessages } from '@/lib/i18n/server.ts'
import { startAiJob } from '@/lib/server/ai-flow.ts'
import {
  createDesign,
  deleteDesign,
  designCover,
  getBrandKit,
  getRole,
  getWorkspace,
  listBrands,
  listDesigns,
} from '@/lib/server/api.ts'
import { startBriefDesign } from '@/lib/server/brief-start.ts'
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

  const draftName = t.editor.brief.draftName

  /** Makes the drafts and opens their design; gives why when the brief didn't start. */
  async function make(form: FormData): Promise<string | undefined> {
    'use server'
    const brief = briefFromForm(form)
    if (brief.words === '') return 'noWords'
    const started = await startBriefDesign(
      {
        createDesign: (name, content) => createDesign(workspaceId, brandId, name, content),
        startRound: (round) => startAiJob(workspaceId, brandId, round),
        deleteDesign: (designId) => deleteDesign(workspaceId, brandId, designId),
      },
      {
        brief,
        name: designName(brief.words) || untitled,
        draftName: (n) => format(draftName, { n: n + 1 }),
        newId: () => crypto.randomUUID(),
      },
    )
    if ('refused' in started) return briefSaid({ refusal: started.refused })
    redirect(brandPath(workspaceId, brandId, 'designs', started.designId))
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
