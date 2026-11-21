'use client'

// The brand kit in the editor while it is open, whether the Brand flyout is or not. Each kit the tab
// shows after the first (a change made in the flyout, a kit fetched since, or the newer kit shown
// after a refused save) gives the bound layers its values at once, the logo's when it is known, and
// again once a new logo is found in the library. A save refused while the flyout is closed says so
// as the stage's notice, since the flyout that would say it isn't there, and so does one whose newer
// kit couldn't be fetched.
import { useEffect, useRef } from 'react'

import type { Editor } from '@dazbee/editor'
import { type BrandKit, brandVariables } from '@dazbee/schema'

import { partNames, refusedWords } from '@/components/brand-kit/kit-changes.ts'
import { kitLogo, knownAsset } from '@/components/brand-kit/kit-logo.ts'
import { useBrandKit, useKitTrouble } from '@/components/brand-kit/use-brand-kit.ts'
import { useEditState } from '@/components/editor/edit-store.ts'
import { useLocale, useMessages } from '@/lib/i18n/client.tsx'
import { format } from '@/lib/i18n/index.ts'

/** Renders nothing: it keeps the editor's brand values on the kit the tab shows. */
export function KitVariables({
  editor,
  workspaceId,
  brandId,
  tell,
}: {
  editor: Editor
  workspaceId: string
  brandId: string
  /** Shows words as the stage's notice. */
  tell: (text: string) => void
}) {
  const t = useMessages()
  const locale = useLocale()
  const kit = useBrandKit(workspaceId, brandId)
  const trouble = useKitTrouble(brandId)
  const brandOpen = useEditState().flyout === 'brand'
  /** The kit whose values the editor has: the first is the one it opened with. */
  const given = useRef<BrandKit | null>(kit)
  /** The refusal already told, so each is told once. */
  const told = useRef(trouble)

  useEffect(() => {
    if (!kit || kit === given.current) return
    given.current = kit
    const logo = knownAsset(kit.logoAssetId)
    void editor.setVariables(brandVariables(kit, logo))
    if (logo || !kit.logoAssetId) return
    void kitLogo(workspaceId, brandId, kit.logoAssetId).then((found) => {
      if (found && given.current === kit) void editor.setVariables(brandVariables(kit, found))
    })
  }, [editor, kit, workspaceId, brandId])

  useEffect(() => {
    if (trouble === told.current) return
    told.current = trouble
    if (brandOpen || !trouble) return
    const k = t.editor.brandKit
    if (trouble.kind === 'changed') tell(refusedWords(t, locale, trouble.unsaved))
    else if (trouble.kind === 'unreadable' && trouble.unsaved.length > 0)
      tell(`${k.unreadable} ${format(k.unreadableUnsaved, { parts: partNames(t, locale, trouble.unsaved) })}`)
  }, [trouble, brandOpen, tell, t, locale])

  return null
}
