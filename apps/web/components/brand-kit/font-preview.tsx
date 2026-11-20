'use client'

// A family's name drawn in its own face, from the picture of it the API stores, so the browser never
// decodes a design font; its files load in the editor only once a layer uses it.
import type { FontFamily } from '@dazbee/schema'

import { brandPath } from '@/lib/brand-routes.ts'
import { cn } from '@/lib/cn.ts'

import { previewFace } from './font-catalog.ts'

/**
 * How wide a preview shows at most, in pixels: the API draws it at most 640 pixels wide at twice
 * the size it shows.
 */
const PREVIEW_WIDTH = 320

/** A family's name drawn in its own face. */
export function FontPreview({
  workspaceId,
  brandId,
  family,
  className,
  big = false,
}: {
  workspaceId: string
  brandId: string
  family: FontFamily
  className?: string
  big?: boolean
}) {
  const face = previewFace(family)
  if (family.source === 'builtin' || !face)
    return (
      <span
        className={cn(
          'block truncate',
          big ? 'text-heading-lg leading-8 font-semibold tracking-tight' : 'text-small',
          className,
        )}
      >
        {family.family}
      </span>
    )
  return (
    // The family's name drawn in its own face by the API, at twice the size it shows. A lazy image
    // has its size given before it loads, so its row never changes size as it arrives; the name is
    // drawn at its start, its own width.
    <img
      src={brandPath(workspaceId, brandId, 'fonts', face.id, 'preview')}
      alt={family.family}
      loading="lazy"
      width={PREVIEW_WIDTH}
      height={big ? 32 : 24}
      draggable={false}
      className={cn(
        big ? 'h-8' : 'h-6',
        'max-w-full object-contain object-left dark:invert rtl:object-right',
        className,
      )}
    />
  )
}
