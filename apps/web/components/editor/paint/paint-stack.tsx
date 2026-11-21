'use client'

// Paints as the cards edit them (#219): each row's swatch opens a paint editor that switches it
// between a solid colour, a linear, radial or angular gradient and an image, and edits a gradient's
// stops (add, move, remove, colour and opacity, brand and recent colours too) and its angle or
// centre. A row hides its paint without deleting it, and a gradient or image has its own opacity.
import * as Popover from '@radix-ui/react-popover'
import { useState } from 'react'

import type { Editor } from '@dazbee/editor'
import { type Paint, withAlpha } from '@dazbee/schema'

import { useBesidePanel } from '@/components/editor/beside-panel.ts'
import { ColorField, OpacityField } from '@/components/editor/edit-panel/colour-field.tsx'
import { Choice } from '@/components/editor/edit-panel/fields.tsx'
import { clamp, NumberField } from '@/components/editor/edit-panel/number-field.tsx'
import type { P } from '@/components/editor/edit-panel/target.ts'
import { ImagePickerButton } from '@/components/editor/image-picker.tsx'
import { usePopoverFocus } from '@/components/editor/popover-focus.tsx'
import { CHIP, FACE_SIZE, ICON_BUTTON, KNOBS, SQUARE_SWATCH_TARGET } from '@/components/editor/styles.ts'
import { ViewOnlyFieldset } from '@/components/editor/view-only.tsx'
import { EyeIcon, EyeSlashIcon, ImageIcon, MinusIcon } from '@/components/ui/icons.tsx'
import { FOCUS_RING, POPOVER, SEGMENT, SEGMENTS, TOUCH_GAP } from '@/components/ui/looks.ts'
import { Radio, RadioGroup } from '@/components/ui/radio-group.tsx'
import { brandPath } from '@/lib/brand-routes.ts'
import { cn } from '@/lib/cn.ts'
import { hexOf } from '@/lib/colour.ts'
import { tidy } from '@/lib/editor/size.ts'
import { format } from '@/lib/i18n/index.ts'

import { BrandColours } from './brand-colours.tsx'
import { angleOf, type Gradient, GradientBar, linearAt, type Stop, stopsCss } from './gradient-bar.tsx'
import { RecentSwatches, useShownRecent } from './recent-swatches.tsx'
import { TileScaleField } from './tile-scale-field.tsx'

/** An image asset's small picture, as the API serves it. */
export const assetThumbnail = (workspaceId: string, brandId: string, assetId: string) =>
  brandPath(workspaceId, brandId, 'assets', assetId, 'thumbnail')
const PAINT_TYPES = ['solid', 'linear', 'radial', 'angular', 'image'] as const
type PaintType = (typeof PAINT_TYPES)[number]

const isGradient = (paint: Paint): paint is Gradient =>
  paint.type === 'linear' || paint.type === 'radial' || paint.type === 'angular'
/** What a paint keeps whatever its kind: its own opacity and whether it shows. */
const keepOf = (paint: Paint) => ({
  ...(paint.opacity === undefined ? {} : { opacity: paint.opacity }),
  ...(paint.visible === undefined ? {} : { visible: paint.visible }),
})
/** A paint as a CSS background, close to what the renderer draws in the layer's box. */
function paintBackground(paint: Paint, workspaceId: string, brandId: string): string {
  switch (paint.type) {
    case 'solid':
      return `linear-gradient(${paint.color}, ${paint.color})`
    case 'linear':
      return `linear-gradient(${angleOf(paint) + 90}deg, ${stopsCss(paint.stops, 'percent')})`
    case 'radial':
      // The same share of each side of the square swatch: a circle, as the layer's radial is.
      return `radial-gradient(${tidy(paint.radius * 100)}% ${tidy(paint.radius * 100)}% at ${tidy(paint.center.x * 100)}% ${tidy(paint.center.y * 100)}%, ${stopsCss(paint.stops, 'percent')})`
    case 'angular':
      return `conic-gradient(from ${paint.angle + 90}deg at ${tidy(paint.center.x * 100)}% ${tidy(paint.center.y * 100)}%, ${stopsCss(paint.stops, 'degrees')})`
    case 'image':
      return `url("${assetThumbnail(workspaceId, brandId, paint.assetId)}") center / cover no-repeat`
  }
}

/**
 * The paint a row turns into when its type is switched: the colours carried over where they can
 * be. A solid holds its opacity in its colour, where its row edits it.
 */
function convert(now: Paint, type: Exclude<PaintType, 'image'>): Paint {
  const keep = keepOf(now)
  const stops: Stop[] =
    now.type === 'solid'
      ? [
          { offset: 0, color: now.color },
          { offset: 1, color: withAlpha(now.color, 0) },
        ]
      : now.type === 'image'
        ? [
            { offset: 0, color: '#000000FF' },
            { offset: 1, color: '#FFFFFFFF' },
          ]
        : now.stops
  switch (type) {
    case 'solid': {
      const color =
        now.type === 'solid' ? now.color : now.type === 'image' ? '#D9D9D9FF' : (stops[0]?.color ?? '#D9D9D9FF')
      const alpha = Math.round(Number.parseInt(color.slice(7, 9) || 'FF', 16) * (now.opacity ?? 1))
      return {
        type,
        color: `${hexOf(color)}${alpha.toString(16).padStart(2, '0').toUpperCase()}`,
        ...(now.visible === undefined ? {} : { visible: now.visible }),
      }
    }
    case 'linear':
      return { type, ...linearAt(90), stops, ...keep }
    case 'radial':
      return { type, center: { x: 0.5, y: 0.5 }, radius: 0.5, stops, ...keep }
    case 'angular':
      return { type, center: { x: 0.5, y: 0.5 }, angle: 0, stops, ...keep }
  }
}

/**
 * One paint in a list: its swatch, which opens its editor, then a solid's colour, or a gradient's
 * or image's name and opacity, and a button that hides it or shows it again.
 */
export function PaintRow({
  paint,
  name,
  workspaceId,
  brandId,
  editor,
  p,
  onSet,
}: {
  paint: Paint
  name: string
  workspaceId: string
  brandId: string
  editor: Editor
  p: P
  onSet: (to: (now: Paint) => Paint) => void
}) {
  const beside = useBesidePanel()
  const hidden = paint.visible === false
  const focus = usePopoverFocus()
  return (
    <div
      className={cn('flex min-w-0 flex-1 items-center gap-1', TOUCH_GAP, hidden && 'opacity-50')}
      data-paint={paint.type}
    >
      <Popover.Root onOpenChange={(open) => open && beside.measure(focus.button.current)}>
        <Popover.Trigger asChild>
          <button
            ref={focus.button}
            type="button"
            aria-label={format(p.editPaint, { name })}
            data-testid="paint-swatch"
            className={cn(SQUARE_SWATCH_TARGET, FOCUS_RING)}
          >
            <PaintSwatch paint={paint} {...{ workspaceId, brandId }} className={cn(FACE_SIZE, 'size-7')} />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            side={beside.side}
            align="start"
            sideOffset={beside.sideOffset}
            collisionPadding={12}
            aria-label={format(p.editPaint, { name })}
            {...focus.content}
            className={cn(POPOVER, 'w-80')}
          >
            {focus.back}
            <ViewOnlyFieldset>
              <PaintEditor {...{ paint, workspaceId, brandId, editor, p, onSet }} />
            </ViewOnlyFieldset>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      {paint.type === 'solid' ? (
        <ColorField
          name={name}
          value={paint.color}
          swatch={false}
          editor={editor}
          brandId={brandId}
          onSet={(to) => onSet((now) => (now.type === 'solid' ? { ...now, color: to(now.color) } : now))}
        />
      ) : (
        <>
          <span className="min-w-0 flex-1 truncate text-tiny text-muted">{p.paint[paint.type]}</span>
          <OpacityField
            name={format(p.alpha, { name })}
            value={paint.opacity ?? 1}
            editor={editor}
            onSet={(v) => onSet((now) => ({ ...now, opacity: tidy(v) }))}
            onEach={(change) => onSet((now) => ({ ...now, opacity: tidy(clamp(change(now.opacity ?? 1), 0, 1)) }))}
          />
        </>
      )}
      <button
        type="button"
        aria-label={format(hidden ? p.showPaint : p.hidePaint, { name })}
        title={format(hidden ? p.showPaint : p.hidePaint, { name })}
        data-testid="paint-visible"
        onClick={() =>
          onSet((now) => {
            if (now.visible !== false) return { ...now, visible: false }
            const shown: Paint = { ...now }
            delete shown.visible
            return shown
          })
        }
        className={ICON_BUTTON}
      >
        {hidden ? <EyeSlashIcon size={14} aria-hidden /> : <EyeIcon size={14} aria-hidden />}
      </button>
    </div>
  )
}

/**
 * One paint's editor: its type, then a solid's colour, a gradient's stops and shape, or an image.
 * Without `offersImage`, as for a text, which an image can't paint, Image is not offered.
 */
export function PaintEditor({
  paint,
  workspaceId,
  brandId,
  editor,
  p,
  onSet,
  offersImage = true,
  colourName,
}: {
  paint: Paint
  workspaceId: string
  brandId: string
  editor: Editor
  p: P
  onSet: (to: (now: Paint) => Paint) => void
  offersImage?: boolean
  /** The name of a solid's colour field; the paint's colour without it. */
  colourName?: string
}) {
  const types = offersImage ? PAINT_TYPES : PAINT_TYPES.filter((type) => type !== 'image')
  const [picked, setPicked] = useState(0)
  const recent = useShownRecent(workspaceId, brandId)
  const stop = isGradient(paint) ? paint.stops[Math.min(picked, paint.stops.length - 1)] : undefined
  const setGradient = (to: (now: Gradient) => Gradient) => onSet((now) => (isGradient(now) ? to(now) : now))
  const setStopColour = (color: (now: string | undefined) => string) =>
    setGradient((now) => ({
      ...now,
      stops: now.stops.map((s, j) =>
        j === Math.min(picked, now.stops.length - 1) ? { ...s, color: color(s.color) } : s,
      ),
    }))
  const pct = (n: number) => tidy(n * 100)
  return (
    <div className="flex flex-col gap-3 p-3" data-testid="paint-editor">
      <RadioGroup
        label={p.paintType}
        options={types}
        value={paint.type}
        onPick={(type) => type !== 'image' && onSet((now) => convert(now, type))}
        className={SEGMENTS}
      >
        {types.map((type) => {
          const on = paint.type === type
          const label = type === 'solid' ? p.solid : p.paint[type]
          if (type === 'image' && !on) {
            return (
              <ImagePickerButton
                key={type}
                workspaceId={workspaceId}
                brandId={brandId}
                title={p.paint.image}
                testId="paint-image"
                className={SEGMENT}
                onPick={(asset) =>
                  onSet((now) => ({ type: 'image', assetId: asset.id, fit: 'fill', opacity: 1, ...keepOf(now) }))
                }
              >
                <span aria-hidden>{p.paintShort.image}</span>
              </ImagePickerButton>
            )
          }
          return (
            <Radio key={type} value={type} aria-label={label} data-paint-type={type} className={SEGMENT}>
              <span aria-hidden>{p.paintShort[type]}</span>
            </Radio>
          )
        })}
      </RadioGroup>
      {paint.type === 'solid' && (
        <>
          <ColorField
            name={colourName ?? p.paintColour}
            value={paint.color}
            editor={editor}
            brandId={brandId}
            onSet={(to) => onSet((now) => (now.type === 'solid' ? { ...now, color: to(now.color) } : now))}
          />
          <BrandColours
            workspaceId={workspaceId}
            brandId={brandId}
            label={p.brandColours}
            onPick={(color) => onSet((now) => (now.type === 'solid' ? { ...now, color } : now))}
          />
          <RecentSwatches
            brandId={brandId}
            colours={recent}
            label={p.recentColours}
            size="size-6"
            gap="gap-1"
            heading
            onPick={(hex) => onSet((now) => (now.type === 'solid' ? { ...now, color: `${hex}FF` } : now))}
          />
        </>
      )}
      {isGradient(paint) && (
        <>
          <GradientBar paint={paint} picked={picked} onPick={setPicked} editor={editor} p={p} onSet={setGradient} />
          <div className={cn('flex items-center gap-1', TOUCH_GAP)}>
            <ColorField
              name={format(p.stopColour, { n: Math.min(picked, paint.stops.length - 1) + 1 })}
              value={stop?.color}
              editor={editor}
              brandId={brandId}
              onSet={setStopColour}
            />
            <button
              type="button"
              aria-label={p.removeStop}
              title={p.removeStop}
              disabled={paint.stops.length <= 2}
              onClick={() => {
                setGradient((now) => ({
                  ...now,
                  stops: now.stops.filter((_, j) => j !== Math.min(picked, now.stops.length - 1)),
                }))
                setPicked(Math.max(0, picked - 1))
              }}
              className={ICON_BUTTON}
            >
              <MinusIcon size={14} aria-hidden />
            </button>
          </div>
          <BrandColours
            workspaceId={workspaceId}
            brandId={brandId}
            label={p.brandColours}
            onPick={(color) => setStopColour(() => color)}
          />
          <RecentSwatches
            brandId={brandId}
            colours={recent}
            label={p.recentColours}
            size="size-6"
            gap="gap-1"
            heading
            onPick={(hex) => setStopColour(() => `${hex}FF`)}
          />
          <div className={KNOBS}>
            {paint.type === 'linear' && (
              <NumberField
                label="∠"
                name={p.gradientAngle}
                value={angleOf(paint)}
                unit="°"
                editor={editor}
                onSet={(v) => setGradient((now) => ({ ...now, ...linearAt(v) }))}
                onEach={(change) =>
                  setGradient((now) => (now.type === 'linear' ? { ...now, ...linearAt(change(angleOf(now))) } : now))
                }
              />
            )}
            {(paint.type === 'radial' || paint.type === 'angular') && (
              <>
                <NumberField
                  label="X"
                  name={p.gradientX}
                  value={pct(paint.center.x)}
                  min={0}
                  max={100}
                  unit="%"
                  editor={editor}
                  onSet={(v) =>
                    setGradient((now) =>
                      now.type === 'linear' ? now : { ...now, center: { ...now.center, x: tidy(v / 100) } },
                    )
                  }
                  onEach={(change) =>
                    setGradient((now) =>
                      now.type === 'linear'
                        ? now
                        : { ...now, center: { ...now.center, x: tidy(clamp(change(now.center.x * 100) / 100, 0, 1)) } },
                    )
                  }
                />
                <NumberField
                  label="Y"
                  name={p.gradientY}
                  value={pct(paint.center.y)}
                  min={0}
                  max={100}
                  unit="%"
                  editor={editor}
                  onSet={(v) =>
                    setGradient((now) =>
                      now.type === 'linear' ? now : { ...now, center: { ...now.center, y: tidy(v / 100) } },
                    )
                  }
                  onEach={(change) =>
                    setGradient((now) =>
                      now.type === 'linear'
                        ? now
                        : { ...now, center: { ...now.center, y: tidy(clamp(change(now.center.y * 100) / 100, 0, 1)) } },
                    )
                  }
                />
              </>
            )}
            {paint.type === 'radial' && (
              <NumberField
                label="R"
                name={p.gradientSize}
                value={pct(paint.radius)}
                min={1}
                unit="%"
                editor={editor}
                onSet={(v) =>
                  setGradient((now) => (now.type === 'radial' ? { ...now, radius: tidy(Math.max(1, v) / 100) } : now))
                }
                onEach={(change) =>
                  setGradient((now) =>
                    now.type === 'radial'
                      ? { ...now, radius: tidy(Math.max(0.01, change(now.radius * 100) / 100)) }
                      : now,
                  )
                }
              />
            )}
            {paint.type === 'angular' && (
              <NumberField
                label="∠"
                name={p.gradientAngle}
                value={paint.angle}
                unit="°"
                editor={editor}
                onSet={(v) => setGradient((now) => (now.type === 'angular' ? { ...now, angle: v } : now))}
                onEach={(change) =>
                  setGradient((now) => (now.type === 'angular' ? { ...now, angle: change(now.angle) } : now))
                }
              />
            )}
          </div>
        </>
      )}
      {paint.type === 'image' && (
        <div className="flex items-center gap-2">
          <PaintSwatch paint={paint} workspaceId={workspaceId} brandId={brandId} className="size-12 shrink-0" />
          <div className={cn('flex min-w-0 flex-1 flex-col gap-1.5', TOUCH_GAP)}>
            <ImagePickerButton
              workspaceId={workspaceId}
              brandId={brandId}
              title={p.replaceImageTitle}
              testId="paint-replace-image"
              className={cn(CHIP, FOCUS_RING, 'self-start')}
              onPick={(asset) => onSet((now) => (now.type === 'image' ? { ...now, assetId: asset.id } : now))}
            >
              <ImageIcon size={12} aria-hidden />
              <span aria-hidden>{p.replaceImage}</span>
            </ImagePickerButton>
            <Choice
              name={p.fit}
              value={paint.fit}
              options={['fill', 'fit', 'crop', 'tile'] as const}
              labels={p.fits}
              onSet={(fit) => onSet((now) => (now.type === 'image' ? { ...now, fit } : now))}
            />
            {paint.fit === 'tile' && (
              <TileScaleField
                value={paint.tileScale}
                editor={editor}
                onScale={(to) =>
                  onSet((now) => (now.type === 'image' ? { ...now, tileScale: to(now.tileScale ?? 1) } : now))
                }
              />
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/** A paint's swatch over a checkerboard, so a see-through paint shows as one. */
function PaintSwatch({
  paint,
  workspaceId,
  brandId,
  className,
}: {
  paint: Paint
  workspaceId: string
  brandId: string
  className?: string
}) {
  return (
    <span
      aria-hidden
      className={cn('checker relative block overflow-hidden rounded-row border border-line-strong', className)}
    >
      <span
        className="absolute inset-0"
        style={{ background: paintBackground(paint, workspaceId, brandId), opacity: paint.opacity ?? 1 }}
      />
    </span>
  )
}
