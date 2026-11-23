'use client'

// An image fill's filters, and its adjustments with how much of it shows: a photo's in the Image
// tab, and a text image fill's in the paint editor. Each change is one undo step.
import type { Editor } from '@dazbee/editor'
import { type ImageAdjust, ImageFilter, type ImagePaint } from '@dazbee/schema'

import { PanelPart } from '@/components/editor/edit-panel/fields.tsx'
import { clamp, NumberField } from '@/components/editor/edit-panel/number-field.tsx'
import type { P } from '@/components/editor/edit-panel/target.ts'
import { TOUCH_GAP } from '@/components/ui/looks.ts'
import { Radio, RadioGroup } from '@/components/ui/radio-group.tsx'
import { cn } from '@/lib/cn.ts'
import { tidy } from '@/lib/editor/size.ts'
import { useMessages } from '@/lib/i18n/client.tsx'

/** What these parts change of an image fill. */
type Adjustable = Pick<ImagePaint, 'filter' | 'adjust' | 'opacity'>

/** Writes a change to the image fill, made from each fill's own settings. */
type ChangeImage = (change: (now: Adjustable) => Partial<Adjustable>) => void

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

/**
 * An image fill's filters, each as the image's thumbnail `picture` with it, then its adjustments
 * and how much of it shows, each part under its heading.
 */
export function ImageAdjustments({
  picture,
  editor,
  p,
  paint,
  onChange,
}: {
  picture: string
  editor: Editor
  p: P
  paint: Adjustable
  onChange: ChangeImage
}) {
  return (
    <>
      <FilterTiles picture={picture} p={p} paint={paint} onChange={onChange} />
      <AdjustFields editor={editor} p={p} paint={paint} onChange={onChange} />
    </>
  )
}

/** The filters, under their heading, each as the image's thumbnail `picture` with it. */
function FilterTiles({
  picture,
  p,
  paint,
  onChange,
}: {
  picture: string
  p: P
  paint: Adjustable
  onChange: ChangeImage
}) {
  const title = useMessages().editor.bar.filters
  const filter = paint.filter ?? 'none'
  return (
    <PanelPart id="look-card" title={title}>
      <RadioGroup
        label={p.filter}
        options={ImageFilter.options}
        value={filter}
        onPick={(name) => onChange(() => ({ filter: name === 'none' ? undefined : name }))}
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
    </PanelPart>
  )
}

/**
 * The image's adjustments as slider fields, one to a row, each filling from 0 either way: its light,
 * contrast, saturation, warmth and tint; then how much of the image shows.
 */
function AdjustFields({
  editor,
  p,
  paint,
  onChange,
}: {
  editor: Editor
  p: P
  paint: Adjustable
  onChange: ChangeImage
}) {
  const setAdjust = (key: keyof ImageAdjust, to: (n: number) => number) =>
    onChange((now) => {
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
            editor={editor}
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
          editor={editor}
          onSet={(v) => onChange(() => ({ opacity: tidy(v) }))}
          onEach={(change) => onChange((now) => ({ opacity: tidy(clamp(change(now.opacity), 0, 1)) }))}
        />
      </div>
    </PanelPart>
  )
}
