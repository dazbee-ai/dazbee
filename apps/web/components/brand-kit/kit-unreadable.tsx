'use client'

// What shows in place of the kit's form when the kit couldn't be fetched or read: an error and a
// reload, never an empty form that would be saved over the kit. After a refused save whose newer kit
// couldn't be fetched, it names the parts whose changes weren't saved.
import { Button } from '@/components/ui/button.tsx'
import { EmptyState } from '@/components/ui/empty-state.tsx'
import { useLocale, useMessages } from '@/lib/i18n/client.tsx'
import { format } from '@/lib/i18n/index.ts'

import { partNames } from './kit-changes.ts'
import { useKitTrouble } from './use-brand-kit.ts'

export function KitUnreadable({ brandId, tight = false }: { brandId: string; tight?: boolean }) {
  const t = useMessages()
  const locale = useLocale()
  const trouble = useKitTrouble(brandId)
  const unsaved = trouble?.kind === 'unreadable' ? trouble.unsaved : []
  const k = t.editor.brandKit
  return (
    <div role="alert" data-testid="kit-unreadable">
      <EmptyState
        pose="dizzy"
        tight={tight}
        title={k.unreadable}
        {...(unsaved.length > 0 ? { line: format(k.unreadableUnsaved, { parts: partNames(t, locale, unsaved) }) } : {})}
        action={
          <Button variant="primary" size={tight ? 'md' : 'lg'} onClick={() => window.location.reload()}>
            {k.reload}
          </Button>
        }
      />
    </div>
  )
}
