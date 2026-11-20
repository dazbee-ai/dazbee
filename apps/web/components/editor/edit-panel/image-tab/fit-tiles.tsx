'use client'

// A photo's fit as tiles, each the layer's own photo drawn that way. Fill, Fit inside and Tile set
// the fit on every selected photo, one undo step; Crop starts cropping, as the Image tab's Crop does.
// While the fit is Tile, its Scale shows under the tiles.
import type { CSSProperties, ReactNode } from 'react'

import type { ImageFill } from '@dazbee/editor'
import { ImageFit } from '@dazbee/schema'

import { moveAlong } from '@/components/editor/arrow-keys.ts'
import { PanelPart } from '@/components/editor/edit-panel/fields.tsx'
import { setImage, type Target } from '@/components/editor/edit-panel/target.ts'
import { assetThumbnail } from '@/components/editor/paint/paint-stack.tsx'
import { TileScaleField } from '@/components/editor/paint/tile-scale-field.tsx'
import { PANEL_PART } from '@/components/editor/styles.ts'
import { FOCUS_RING } from '@/components/ui/looks.ts'
import { useMessages } from '@/lib/i18n/client.tsx'

/** How each tile draws the photo in its square, near what the renderer draws for the fit. */
const FIT_LOOK: Record<ImageFit, CSSProperties> = {
  fill: { backgroundSize: 'cover', backgroundPosition: 'center', backgroundRepeat: 'no-repeat' },
  fit: { backgroundSize: 'contain', backgroundPosition: 'center', backgroundRepeat: 'no-repeat' },
  // A part of the photo, larger than the square.
  crop: { backgroundSize: '250%', backgroundPosition: '30% 40%', backgroundRepeat: 'no-repeat' },
  tile: { backgroundSize: '30px auto', backgroundPosition: '0 0', backgroundRepeat: 'repeat' },
}

/** A fit's tile: the picture over its name, tinted while it is the fit in use. */
const TILE = `flex min-h-11 min-w-0 cursor-pointer flex-col items-center gap-1.5 rounded-[9px] px-1 py-1.5 text-caption text-text transition-colors duration-[var(--chrome-fast)] hover:bg-hover aria-pressed:bg-accent-soft aria-pressed:text-accent-text ${FOCUS_RING}`

/**
 * The fit's tiles for the photo the selected layers share (`photo`, its fill and where it
 * is in their fills), in a row the arrows move along. Crop shows while one layer is selected, as
 * cropping takes one, and runs `onCrop`.
 */
export function FitTiles({
  target,
  workspaceId,
  brandId,
  photo,
  onCrop,
  headed,
}: {
  target: Target
  workspaceId: string
  brandId: string
  photo: { index: number; paint: ImageFill }
  /** Starts cropping the one selected layer; left out while several are selected. */
  onCrop?: (() => void) | undefined
  /** Whether it shows its Fit heading; without, the name is only for a screen reader. */
  headed: boolean
}) {
  const p = useMessages().editor.props
  const picture = `url("${assetThumbnail(workspaceId, brandId, photo.paint.assetId)}")`
  const fits = ImageFit.options.filter((fit) => fit !== 'crop' || onCrop)
  const pick = (fit: ImageFit) => {
    if (fit === 'crop') onCrop?.()
    else if (fit !== photo.paint.fit) setImage(target, photo.index, () => ({ fit }))
  }
  return (
    <Titled id="fit-card" title={p.fit} headed={headed}>
      <div
        role="group"
        aria-label={p.fit}
        onKeyDown={(event) => moveAlong(event, [...event.currentTarget.querySelectorAll('button')])}
        className="grid auto-cols-fr grid-flow-col gap-0.5"
      >
        {fits.map((fit) => (
          <button
            key={fit}
            type="button"
            aria-pressed={photo.paint.fit === fit}
            data-fit={fit}
            onClick={() => pick(fit)}
            className={TILE}
          >
            <span
              aria-hidden
              className="block size-[54px] shrink-0 rounded-[7px] border border-line bg-bg/60"
              style={{ backgroundImage: picture, ...FIT_LOOK[fit] }}
            />
            <span className="max-w-full truncate">{p.fits[fit]}</span>
          </button>
        ))}
      </div>
      {photo.paint.fit === 'tile' && (
        <div className="mt-2">
          <TileScaleField
            value={photo.paint.tileScale}
            editor={target.editor}
            onScale={(to) => setImage(target, photo.index, (now) => ({ tileScale: to(now.tileScale ?? 1) }))}
          />
        </div>
      )}
    </Titled>
  )
}

/** A part titled `title`: as its heading where `headed`, else only to a screen reader. */
function Titled({ id, title, headed, children }: { id: string; title: string; headed: boolean; children: ReactNode }) {
  if (headed)
    return (
      <PanelPart id={id} title={title}>
        {children}
      </PanelPart>
    )
  return (
    <section aria-label={title} data-testid={id} className={PANEL_PART}>
      {children}
    </section>
  )
}
