'use client'

// A brand text style's sample: its family drawn in the face it sets.
import type { BrandTextStyle, FontFamily } from '@dazbee/schema'

import { cn } from '@/lib/cn.ts'
import { useMessages } from '@/lib/i18n/client.tsx'

import { faceFor } from './font-catalog.ts'
import { FontPreview } from './font-preview.tsx'

/** How CSS draws each case a style can set. */
const CSS_CASES = { upper: 'uppercase', lower: 'lowercase', title: 'capitalize' } as const

export function TextStyleSample({
  workspaceId,
  brandId,
  style,
  known,
  family,
}: {
  workspaceId: string
  brandId: string
  style: BrandTextStyle
  known: FontFamily | undefined
  family: string | undefined
}) {
  const t = useMessages().editor.brandKit
  return (
    <div className="flex h-8 items-center overflow-hidden px-2" data-testid="text-style-sample">
      {known && known.source !== 'builtin' ? (
        <FontPreview
          workspaceId={workspaceId}
          brandId={brandId}
          family={known}
          face={faceFor(known, style.fontWeight, style.fontStyle)}
        />
      ) : (
        // A family with no stored picture: its name in the app's own font, set as the style sets it.
        <span
          className={cn('truncate text-small', !family && 'text-muted')}
          // The words for a font that isn't set aren't the style's sample, so they keep their own case.
          style={{
            fontWeight: style.fontWeight,
            fontStyle: style.fontStyle,
            letterSpacing:
              style.letterSpacing.unit === 'px'
                ? `${style.letterSpacing.value}px`
                : `${style.letterSpacing.value / 100}em`,
            textTransform:
              family && style.textCase && style.textCase !== 'none' ? CSS_CASES[style.textCase] : undefined,
          }}
        >
          {family ?? t.notSet}
        </span>
      )}
    </div>
  )
}
