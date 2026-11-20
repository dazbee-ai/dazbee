'use client'

// What keeps the kit from being saved as it shows, over its form: a save refused since the kit was
// saved elsewhere, which stays until it is dismissed, or a save that failed.
import { XIcon } from '@/components/ui/icons.tsx'
import { cn } from '@/lib/cn.ts'
import { useLocale, useMessages } from '@/lib/i18n/client.tsx'
import { format } from '@/lib/i18n/index.ts'

import { refusedWords } from './kit-changes.ts'
import { iconButton } from './kit-parts.ts'
import { dismissKitTrouble, useKitTrouble } from './use-brand-kit.ts'

export function KitTroubleNotice({ brandId, className }: { brandId: string; className?: string }) {
  const t = useMessages()
  const locale = useLocale()
  const trouble = useKitTrouble(brandId)
  if (trouble?.kind === 'failed')
    return (
      <p role="alert" className={cn('text-tiny text-danger', className)}>
        {format(t.editor.brandKit.saveFailed, { reason: trouble.reason })}
      </p>
    )
  if (trouble?.kind !== 'changed') return null
  return (
    <div role="alert" data-testid="kit-changed" className={cn('flex items-start gap-2', className)}>
      <p className="min-w-0 flex-1 text-small text-danger">{refusedWords(t, locale, trouble.unsaved)}</p>
      <button
        type="button"
        aria-label={t.editor.brandKit.dismiss}
        title={t.editor.brandKit.dismiss}
        onClick={() => dismissKitTrouble(brandId)}
        className={iconButton}
      >
        <XIcon size={13} aria-hidden />
      </button>
    </div>
  )
}
