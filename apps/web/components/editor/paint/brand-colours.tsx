'use client'

// The brand's colours as small round buttons, which a paint editor picks a colour or a stop's colour from.
import { inBrandRoleOrder } from '@dazbee/schema'

import { kitEntryName } from '@/components/brand-kit/kit-names.ts'
import { useBrandKit } from '@/components/brand-kit/use-brand-kit.ts'
import { SWATCH_ROW } from '@/components/editor/styles.ts'
import { cn } from '@/lib/cn.ts'
import { hexOf } from '@/lib/colour.ts'
import { useMessages } from '@/lib/i18n/client.tsx'

import { Swatch } from './swatch.tsx'

/** The brand's colours as small round buttons that pick one. */
export function BrandColours({
  workspaceId,
  brandId,
  label,
  onPick,
}: {
  workspaceId: string
  brandId: string
  label: string
  onPick: (color: string) => void
}) {
  const colors = inBrandRoleOrder('color', useBrandKit(workspaceId, brandId)?.colors ?? [])
  const roles = useMessages().editor.brandKit.brandRoles
  if (colors.length === 0) return null
  return (
    <div role="group" aria-label={label} className={cn(SWATCH_ROW, 'gap-1')}>
      {colors.map((c) => (
        <Swatch
          key={c.token}
          color={c.value}
          label={`${kitEntryName(roles, 'color', c)} ${hexOf(c.value)}`}
          title={kitEntryName(roles, 'color', c)}
          size="size-6"
          onPick={() => onPick(c.value)}
        />
      ))}
    </div>
  )
}
