'use client'

// The Brand kit page's form (#200): the kit's whole form, laid out wide, so a brand's colours, fonts,
// logo and voice are set before any design. A change shows in the brief's kit picker at once and is
// saved a moment later. While the kit has nothing in it, Daz says so, and Edit kit shows the form. A
// kit that can't be read shows an error and a reload instead.
import { useEffect, useState } from 'react'

import type { StoredBrandKit } from '@dazbee/schema'

import { Button } from '@/components/ui/button.tsx'
import { EmptyState } from '@/components/ui/empty-state.tsx'
import { useMessages } from '@/lib/i18n/client.tsx'

import { KitEditor, useKitSaver } from './kit-editor.tsx'
import { kitIsEmpty } from './kit-empty.ts'
import { KitUnreadable } from './kit-unreadable.tsx'
import { loadKit, useBrandKit, useKitTrouble } from './use-brand-kit.ts'

export function KitPage({
  workspaceId,
  brandId,
  kit: first,
}: {
  workspaceId: string
  brandId: string
  /** The kit as the page came with it, shown until the shared copy has it; null when it couldn't be read. */
  kit: StoredBrandKit | null
}) {
  const trouble = useKitTrouble(brandId)
  // The page's kit draws on the server and while the page hydrates, until the shared copy is read.
  const kit = useBrandKit(workspaceId, brandId, first) ?? (trouble ? null : first)
  const { change } = useKitSaver(workspaceId, brandId)
  const words = useMessages().library.emptyKit
  // Edit kit was pressed: the form stays once it shows, even while the kit is still empty.
  const [editing, setEditing] = useState(false)
  // Fetched again as the panel opens, for a change made in another tab since the page came.
  useEffect(() => {
    void loadKit(workspaceId, brandId)
  }, [workspaceId, brandId])
  if (!kit) return trouble?.kind === 'unreadable' ? <KitUnreadable /> : <div aria-busy="true" />
  if (!editing && kitIsEmpty(kit))
    return (
      <EmptyState
        pose="palette"
        title={words.title}
        line={words.line}
        action={
          <Button variant="primary" size="lg" onClick={() => setEditing(true)}>
            {words.action}
          </Button>
        }
      />
    )
  return (
    <div data-testid="home-kit">
      <KitEditor workspaceId={workspaceId} brandId={brandId} kit={kit} change={change} wide />
    </div>
  )
}
