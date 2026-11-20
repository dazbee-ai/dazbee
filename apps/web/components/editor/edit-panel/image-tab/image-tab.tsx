'use client'

// The Image switcher tab's sections for one or several photos: Replace, and Crop for one photo; the
// fit, as tiles; then the filters, the adjustments and how much of the photo shows, and every fill.
// Each change is one undo step. A locked layer's settings are turned off and dimmed, and Replace and
// Crop's section says why, once for the tab.
import type { ReactNode } from 'react'

import { type ImageFill, withImage } from '@dazbee/editor'
import { type Design, type ImageAdjust, ImageFilter, type Paint } from '@dazbee/schema'

import { FillsCard } from '@/components/editor/edit-panel/colour-panel.tsx'
import { PanelPart } from '@/components/editor/edit-panel/fields.tsx'
import { clamp, NumberField } from '@/components/editor/edit-panel/number-field.tsx'
import type { SectionProps } from '@/components/editor/edit-panel/tabs/tabs.ts'
import { factsOf, imageFillOf, type P, set, setImage, type Target } from '@/components/editor/edit-panel/target.ts'
import { ImagePickerButton } from '@/components/editor/image-picker.tsx'
import { assetThumbnail } from '@/components/editor/paint/paint-stack.tsx'
import { PANEL_ACTION, PANEL_PART } from '@/components/editor/styles.ts'
import { ViewOnlyFieldset } from '@/components/editor/view-only.tsx'
import { GreyedButton } from '@/components/ui/greyed.tsx'
import { ArrowsClockwiseIcon, CropIcon } from '@/components/ui/icons.tsx'
import { TOUCH_GAP } from '@/components/ui/looks.ts'
import { Radio, RadioGroup } from '@/components/ui/radio-group.tsx'
import { Tooltip, withShortcut } from '@/components/ui/tooltip.tsx'
import { cn } from '@/lib/cn.ts'
import { keyOf } from '@/lib/editor/shortcut-keys.ts'
import { tidy } from '@/lib/editor/size.ts'
import { useMessages } from '@/lib/i18n/client.tsx'

import { FitTiles } from './fit-tiles.tsx'

const ADJUSTMENTS = ['exposure', 'contrast', 'saturation', 'temperature', 'tint'] as const

/** Each filter's tile: the image's picture with a CSS look near the one the renderer draws. */
const FILTER_LOOK: Record<ImageFilter, string> = {
  none: 'none',
  mono: 'grayscale(1)',
  sepia: 'sepia(0.85)',
  vivid: 'saturate(1.7) contrast(1.1)',
  fade: 'contrast(0.75) brightness(1.12) saturate(0.75)',
  warm: 'sepia(0.3) saturate(1.35) hue-rotate(-12deg)',
  cool: 'saturate(0.9) hue-rotate(18deg) brightness(1.04)',
}
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
      <PanelPart id="look-card" title={t.editor.bar.filters}>
        <PhotoLookBody
          target={target}
          p={p}
          workspaceId={workspaceId}
          brandId={brandId}
          index={imageFill.index}
          paint={imageFill.paint}
        />
      </PanelPart>
      <AdjustCard target={target} p={p} index={imageFill.index} paint={imageFill.paint} />
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

/** The filters, each as the photo with it. */
function PhotoLookBody({
  target,
  p,
  workspaceId,
  brandId,
  index,
  paint,
}: {
  target: Target
  p: P
  workspaceId: string
  brandId: string
  index: number
  paint: ImageFill
}) {
  const picture = assetThumbnail(workspaceId, brandId, paint.assetId)
  const filter = paint.filter ?? 'none'
  return (
    <RadioGroup
      label={p.filter}
      options={ImageFilter.options}
      value={filter}
      onPick={(name) => setImage(target, index, () => ({ filter: name === 'none' ? undefined : name }))}
      className="grid grid-cols-4 gap-1.5"
    >
      {ImageFilter.options.map((name) => (
        <Radio
          key={name}
          value={name}
          className="group flex min-w-0 cursor-pointer flex-col items-center gap-1 text-micro text-muted aria-checked:text-text"
        >
          <span className="block aspect-square w-full overflow-hidden rounded-[8px] border border-line group-aria-checked:shadow-[0_0_0_2px_var(--surface),0_0_0_4px_var(--accent)]">
            <img
              src={picture}
              alt=""
              draggable={false}
              loading="lazy"
              style={{ filter: FILTER_LOOK[name] }}
              className="size-full object-cover"
            />
          </span>
          <span className="w-full truncate text-center">{p.filters[name]}</span>
        </Radio>
      ))}
    </RadioGroup>
  )
}

/**
 * The photo's adjustments as slider fields, one to a row, each filling from 0 either way: its light,
 * contrast, saturation, warmth and tint; then how much of the image shows.
 */
function AdjustCard({ target, p, index, paint }: { target: Target; p: P; index: number; paint: ImageFill }) {
  const setPaint = (change: (now: ImageFill) => Partial<ImageFill>) => setImage(target, index, change)
  const setAdjust = (key: keyof ImageAdjust, to: (n: number) => number) =>
    setPaint((now) => {
      const adjust = { exposure: 0, contrast: 0, saturation: 0, temperature: 0, tint: 0, ...now.adjust }
      return { adjust: { ...adjust, [key]: Math.round(clamp(to(adjust[key]), -100, 100)) } }
    })
  return (
    <PanelPart id="adjust-card" title={p.adjustTitle}>
      <div className={cn('grid gap-1.5', TOUCH_GAP)}>
        {ADJUSTMENTS.map((key) => (
          <NumberField
            key={key}
            label={p.adjust[key]}
            name={p.adjust[key]}
            value={paint.adjust?.[key] ?? 0}
            min={-100}
            max={100}
            editor={target.editor}
            onSet={(v) => setAdjust(key, () => v)}
            onEach={(change) => setAdjust(key, change)}
          />
        ))}
        <NumberField
          label={p.imageOpacity}
          unit="%"
          name={p.imageOpacity}
          value={paint.opacity}
          scale={100}
          min={0}
          max={1}
          editor={target.editor}
          onSet={(v) => setPaint(() => ({ opacity: tidy(v) }))}
          onEach={(change) => setPaint((now) => ({ opacity: tidy(clamp(change(now.opacity), 0, 1)) }))}
        />
      </div>
    </PanelPart>
  )
}
