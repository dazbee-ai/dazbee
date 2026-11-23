'use client'

// The Image switcher tab's sections for one or several photos: Replace, and Crop for one photo; the
// fit, as tiles; then the filters, the adjustments and how much of the photo shows, and every fill.
// Each change is one undo step. A locked layer's settings are turned off and dimmed, and Replace and
// Crop's section says why, once for the tab.
import type { ReactNode } from 'react'

import { withImage } from '@dazbee/editor'
import { type Design, type Paint } from '@dazbee/schema'

import { FillsCard } from '@/components/editor/edit-panel/colour-panel.tsx'
import type { SectionProps } from '@/components/editor/edit-panel/tabs/tabs.ts'
import { factsOf, imageFillOf, set, setImage, type Target } from '@/components/editor/edit-panel/target.ts'
import { ImagePickerButton } from '@/components/editor/image-picker.tsx'
import { ImageAdjustments } from '@/components/editor/paint/image-adjustments.tsx'
import { assetThumbnail } from '@/components/editor/paint/paint-stack.tsx'
import { PANEL_ACTION, PANEL_PART } from '@/components/editor/styles.ts'
import { ViewOnlyFieldset } from '@/components/editor/view-only.tsx'
import { GreyedButton } from '@/components/ui/greyed.tsx'
import { ArrowsClockwiseIcon, CropIcon } from '@/components/ui/icons.tsx'
import { TOUCH_GAP } from '@/components/ui/looks.ts'
import { Tooltip, withShortcut } from '@/components/ui/tooltip.tsx'
import { cn } from '@/lib/cn.ts'
import { keyOf } from '@/lib/editor/shortcut-keys.ts'
import { useMessages } from '@/lib/i18n/client.tsx'

import { FitTiles } from './fit-tiles.tsx'

/** Replace and Crop: one of Arrange's action rows, 44 px tall on a phone. */
const PHOTO_ACTION = cn(PANEL_ACTION, 'max-sm:h-[44px]')

/** Why the layers' settings are turned off, `locked`, while they are locked; null while they may change. */
function lockedWhy(target: Target, design: Design, locked: string) {
  return factsOf(target, design).locked.length > 0 ? locked : null
}

/**
 * Starts cropping the one selected photo, as Enter does on the stage, and gives the stage the keys,
 * so Enter and Esc end the crop there.
 */
function startCropping(target: Target) {
  target.editor.perform('editPoints')
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
}

/**
 * Replace, which opens the image picker beside the panel and puts the image picked in every
 * selected photo, and Crop while `controls` has it, side by side. While the layers are locked both
 * are greyed, and the section says why.
 */
export function PhotoSection({ target, design, workspaceId, brandId, controls }: SectionProps) {
  const t = useMessages()
  const p = t.editor.props
  const why = lockedWhy(target, design, t.editor.bar.lockedRow)
  const icon = <ArrowsClockwiseIcon size={15} aria-hidden className="shrink-0" />
  const replace = why ? (
    <GreyedButton why={why} data-testid="image-replace" className={PHOTO_ACTION}>
      {icon}
      <span>{p.replaceImage}</span>
    </GreyedButton>
  ) : (
    <ImagePickerButton
      workspaceId={workspaceId}
      brandId={brandId}
      title={p.replaceImageTitle}
      testId="image-replace"
      className={PHOTO_ACTION}
      onPick={(asset) => set(target, (now) => ({ fills: withImage((now.fills ?? []) as Paint[], asset.id) }))}
    >
      {icon}
      <span aria-hidden>{p.replaceImage}</span>
    </ImagePickerButton>
  )
  return (
    <div data-testid="photo-section" className={PANEL_PART}>
      {why && <p className="text-caption font-medium text-muted">{why}</p>}
      <div className={cn('grid gap-1.5', TOUCH_GAP, controls.includes('crop') ? 'grid-cols-2' : 'grid-cols-1')}>
        {controls.includes('replace') && replace}
        {controls.includes('crop') && <CropButton target={target} design={design} why={why} />}
      </div>
    </div>
  )
}

/**
 * The fit, as tiles of the photo drawn each way; for one photo the Crop tile starts cropping, as
 * Crop does.
 */
export function FitSection({ target, design, workspaceId, brandId, headed }: SectionProps) {
  const photo = imageFillOf(target)
  if (!photo) return null
  return (
    <Locked target={target} design={design}>
      <FitTiles
        target={target}
        workspaceId={workspaceId}
        brandId={brandId}
        photo={photo}
        onCrop={target.ids.length > 1 ? undefined : () => startCropping(target)}
        headed={headed}
      />
    </Locked>
  )
}

/** The photo's filters, its adjustments and how much of it shows, then every fill, each part under its own heading. */
export function EditSection({ target, design, workspaceId, brandId }: SectionProps) {
  const t = useMessages()
  const p = t.editor.props
  const imageFill = imageFillOf(target)
  if (!imageFill) return null
  return (
    <Locked target={target} design={design}>
      <ImageAdjustments
        picture={assetThumbnail(workspaceId, brandId, imageFill.paint.assetId)}
        editor={target.editor}
        p={p}
        paint={imageFill.paint}
        onChange={(to) => setImage(target, imageFill.index, to)}
      />
      <FillsCard target={target} workspaceId={workspaceId} brandId={brandId} p={p} b={t.editor.bar} />
    </Locked>
  )
}

/** Crop, with its shortcut in its tooltip; greyed with `why` while the layer is locked. */
function CropButton({ target, design, why }: { target: Target; design: Design; why: string | null }) {
  const t = useMessages()
  const name = t.editor.bar.crop
  const face = (
    <>
      <CropIcon size={15} aria-hidden className="shrink-0" />
      <span>{name}</span>
    </>
  )
  if (why)
    return (
      <GreyedButton why={why} data-testid="image-crop" className={PHOTO_ACTION}>
        {face}
      </GreyedButton>
    )
  const key = keyOf('editPoints', { design, ids: target.ids })
  return (
    <Tooltip label={key ? withShortcut(name, key) : name}>
      <button type="button" data-testid="image-crop" onClick={() => startCropping(target)} className={PHOTO_ACTION}>
        {face}
      </button>
    </Tooltip>
  )
}

/** A section's parts, turned off and dimmed while the layers are locked. */
function Locked({ target, design, children }: { target: Target; design: Design; children: ReactNode }) {
  const off = factsOf(target, design).locked.length > 0
  return (
    <div className={cn(PANEL_PART, 'gap-3')}>
      <ViewOnlyFieldset off={off}>
        <div className={cn('flex flex-col gap-3', off && 'opacity-40')}>{children}</div>
      </ViewOnlyFieldset>
    </div>
  )
}
