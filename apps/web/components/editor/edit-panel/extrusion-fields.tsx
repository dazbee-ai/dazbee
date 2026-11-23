'use client'

// Text's 3D in the Effects panel: its depth and angle, and how its sides are coloured.
import { BrandColours } from '@/components/editor/paint/brand-colours.tsx'
import { RemoveButton } from '@/components/editor/reorder-list.tsx'
import { KNOBS } from '@/components/editor/styles.ts'
import { TOUCH_GAP } from '@/components/ui/looks.ts'
import { cn } from '@/lib/cn.ts'
import { format } from '@/lib/i18n/index.ts'

import { ColorField } from './colour-field.tsx'
import { anglePatch, depthPatch, type SharedExtrusion, SIDE_COLOURS, sideColourPatch, sidesPatch } from './extrusion.ts'
import { Choice } from './fields.tsx'
import { NumberField } from './number-field.tsx'
import { type P, set, type Target } from './target.ts'

/**
 * Text's 3D: its depth, as a percentage of the font size, and its angle in degrees, then how its
 * sides are coloured: a darker shade, or a colour with the eyedropper and the brand's colours, which
 * set the colour without binding it.
 */
export function ExtrusionFields({
  extrusion,
  target,
  brandId,
  workspaceId,
  p,
  onRemove,
}: {
  extrusion: SharedExtrusion
  target: Target
  brandId: string
  workspaceId: string
  p: P
  onRemove: () => void
}) {
  const name = p.tiles.extrusion
  return (
    <div className={cn('flex flex-col gap-1.5', TOUCH_GAP)} data-item="text-extrusion">
      <div className="flex items-center justify-between">
        <span className="text-tiny font-bold text-text">{name}</span>
        <RemoveButton label={format(p.remove, { name, n: 1 })} onClick={onRemove} />
      </div>
      <div className={KNOBS}>
        <NumberField
          label={p.extrusionDepth}
          unit="%"
          name={format(p.effectFieldName, { effect: name, n: 1, field: p.extrusionDepth })}
          value={extrusion.depth}
          min={0}
          max={100}
          editor={target.editor}
          onSet={(depth) => set(target, (now) => depthPatch(now, () => depth))}
          onEach={(change) => set(target, (now) => depthPatch(now, change))}
        />
        <NumberField
          label={p.extrusionAngle}
          unit="°"
          name={format(p.effectFieldName, { effect: name, n: 1, field: p.extrusionAngle })}
          value={extrusion.angle}
          // An angle wraps round at 360, so any number typed is one.
          min={Number.NEGATIVE_INFINITY}
          max={Number.POSITIVE_INFINITY}
          editor={target.editor}
          onSet={(angle) => set(target, (now) => anglePatch(now, () => angle))}
          onEach={(change) => set(target, (now) => anglePatch(now, change))}
        />
      </div>
      <Choice
        name={p.extrusionSides}
        value={extrusion.sides}
        options={SIDE_COLOURS}
        labels={p.extrusionSideColours}
        testId="extrusion-sides"
        onSet={(to) => set(target, (now) => sidesPatch(now, to))}
      />
      {extrusion.sides === 'colour' && (
        <>
          <ColorField
            name={p.extrusionSides}
            value={extrusion.color}
            editor={target.editor}
            brandId={brandId}
            onSet={(to) => set(target, (now) => sideColourPatch(now, to))}
          />
          <BrandColours
            workspaceId={workspaceId}
            brandId={brandId}
            label={p.brandColours}
            onPick={(color) => set(target, (now) => sideColourPatch(now, () => color))}
          />
        </>
      )}
    </div>
  )
}
