'use client'

import type { ImageFill } from '@dazbee/editor'
import { type ImageAdjust, ImageFilter } from '@dazbee/schema'

import { PanelPart } from '@/components/editor/edit-panel/fields.tsx'
import { clamp, NumberField } from '@/components/editor/edit-panel/number-field.tsx'
import { type P, setImage, type Target } from '@/components/editor/edit-panel/target.ts'
import { TOUCH_GAP } from '@/components/ui/looks.ts'
import { Radio, RadioGroup } from '@/components/ui/radio-group.tsx'
import { cn } from '@/lib/cn.ts'
import { tidy } from '@/lib/editor/size.ts'

import { assetThumbnail } from './paint-stack.tsx'

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

/** The filters, each as the photo with it. */
export function PhotoLookBody({
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
export function AdjustCard({ target, p, index, paint }: { target: Target; p: P; index: number; paint: ImageFill }) {
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
