'use client'

// The Colour panel: the brand kit's and the design's colours, any paint by +, and every fill under
// its heading Fills; its colour choices are the picked frame's Background panel's too.
import { type ReactNode, useState } from 'react'

import { type Editor, withImage } from '@dazbee/editor'
import {
  boundFillIndex,
  brandRef,
  changeFill,
  type Design,
  inBrandRoleOrder,
  type Paint,
  paintColour,
  showingFillIndex,
} from '@dazbee/schema'

import { kitEntryName } from '@/components/brand-kit/kit-names.ts'
import { useBrandKit } from '@/components/brand-kit/use-brand-kit.ts'
import { ImagePickerButton } from '@/components/editor/image-picker.tsx'
import { assetThumbnail, PaintEditor, PaintRow } from '@/components/editor/paint/paint-stack.tsx'
import { RecentSwatches, rememberColour, useShownRecent } from '@/components/editor/paint/recent-swatches.tsx'
import { Swatch } from '@/components/editor/paint/swatch.tsx'
import { ListBody } from '@/components/editor/reorder-list.tsx'
import {
  PANEL_BUTTON,
  PANEL_PART,
  PANEL_SWATCH,
  SWATCH_FACE,
  SWATCH_ROW,
  SWATCH_TARGET,
  SWATCHES,
} from '@/components/editor/styles.ts'
import { ImageSquareIcon, PlusIcon } from '@/components/ui/icons.tsx'
import { FOCUS_RING } from '@/components/ui/looks.ts'
import { cn } from '@/lib/cn.ts'
import { hexOf, holdsColour } from '@/lib/colour.ts'
import { designColours } from '@/lib/editor/design-colours.ts'
import { useMessages } from '@/lib/i18n/client.tsx'
import { format, type Messages } from '@/lib/i18n/index.ts'

import { EyedropperButton } from './eyedropper.tsx'
import { PanelPart } from './fields.tsx'
import { kindOf, type P, type PanelProps, set, shared, type Target } from './target.ts'
import { colourTexts, firstTextPaint, pickTextPaint, shownTextPaint } from './text-paint.ts'

export const NEW_FILL: Paint = { type: 'solid', color: '#D9D9D9FF' }

/** A fill + adds over others: a see-through wash, so what was there still shows through it. */
export const FILL_ON_TOP: Paint = { type: 'solid', color: '#00000033' }

/** The Colour panel: text's colour for text, else the colour of the fill that shows. */
export function ColourPanel({ target, design, workspaceId, brandId }: PanelProps) {
  const t = useMessages()
  const p = t.editor.props
  return kindOf(target) === 'text' ? (
    <TextColourPanel
      target={target}
      design={design}
      workspaceId={workspaceId}
      brandId={brandId}
      p={p}
      b={t.editor.bar}
    />
  ) : (
    <FillColourPanel
      target={target}
      design={design}
      workspaceId={workspaceId}
      brandId={brandId}
      p={p}
      b={t.editor.bar}
    />
  )
}

/** The fills, under their heading with +: the Colour panel's, and a photo's in its Image switcher tab. */
export function FillsCard({
  target,
  workspaceId,
  brandId,
  p,
  b,
}: {
  target: Target
  workspaceId: string
  brandId: string
  p: P
  b: Messages['editor']['bar']
}) {
  return (
    <div className={PANEL_PART} data-testid="fill-card">
      <FillBody target={target} workspaceId={workspaceId} brandId={brandId} p={p} title={b.colourPanel.fills} />
    </div>
  )
}

/**
 * The colours to pick from, simple first: the brand kit's, which `onBrand` binds to (paint without
 * it), and the colours already in the design, with + first, which opens `picker` under them: any
 * colour, gradient or image. While the layers show one image, its thumbnail `currentImage` leads
 * the kit's row as the paint they have now.
 */
export function ColourChoices({
  editor,
  design,
  workspaceId,
  brandId,
  p,
  b,
  current,
  currentImage,
  paint,
  onBrand,
  picker,
}: {
  editor: Editor
  design: Design
  workspaceId: string
  brandId: string
  p: P
  b: Messages['editor']['bar']
  current: string | 'mixed' | undefined
  currentImage?: string | undefined
  paint: (hex: string) => void
  onBrand?: (token: string, hex: string) => void
  picker: ReactNode
}) {
  const [picking, setPicking] = useState(false)
  const kit = (useBrandKit(workspaceId, brandId)?.colors.length ?? 0) > 0
  const now = current && current !== 'mixed' ? hexOf(current).toUpperCase() : null
  const recent = useShownRecent(workspaceId, brandId)
  return (
    <>
      {/* The kit's colours are headed Brand kit; the fixed set offered without them needs no heading of its own. */}
      {kit ? (
        <PanelPart id="brand-colours" title={b.colourPanel.brandKit}>
          <Swatches
            workspaceId={workspaceId}
            brandId={brandId}
            p={p}
            current={current}
            currentImage={currentImage}
            paint={paint}
            onBrand={onBrand}
          />
        </PanelPart>
      ) : (
        <div className={PANEL_PART} data-testid="brand-colours">
          <Swatches
            workspaceId={workspaceId}
            brandId={brandId}
            p={p}
            current={current}
            currentImage={currentImage}
            paint={paint}
            onBrand={onBrand}
          />
        </div>
      )}
      <PanelPart id="design-colours" title={b.colourPanel.inDesign}>
        <div role="group" aria-label={b.colourPanel.inDesign} className={cn(SWATCH_ROW, 'gap-1.5')}>
          <button
            type="button"
            aria-label={b.colourPanel.pick}
            title={b.colourPanel.pick}
            aria-pressed={picking}
            data-testid="colour-pick"
            onClick={() => setPicking(!picking)}
            className={cn(SWATCH_TARGET, FOCUS_RING)}
          >
            <span
              aria-hidden
              className={cn(
                SWATCH_FACE,
                PANEL_SWATCH,
                'grid place-items-center border border-dashed border-line-strong text-muted transition-colors group-hover/swatch:border-accent group-hover/swatch:text-text group-aria-pressed/swatch:border-accent group-aria-pressed/swatch:text-accent-text',
              )}
            >
              <PlusIcon size={12} weight="bold" />
            </span>
          </button>
          <EyedropperButton
            editor={editor}
            onPick={(hex) => {
              rememberColour(brandId, hex)
              paint(hex)
            }}
            fromKey
            look="swatch"
          />
          {designColours(design).map((hex) => (
            <Swatch key={hex} color={hex} label={hex} size={PANEL_SWATCH} on={now === hex} onPick={() => paint(hex)} />
          ))}
        </div>
        {picking && (
          <div className="rounded-[12px] border border-line" data-testid="colour-picker">
            {picker}
          </div>
        )}
      </PanelPart>
      {/* The Recent part is hidden while empty. */}
      {recent.length > 0 && (
        <PanelPart id="recent-colours" title={b.colourPanel.recent}>
          <RecentSwatches
            brandId={brandId}
            colours={recent}
            label={b.colourPanel.recent}
            size={PANEL_SWATCH}
            gap="gap-1.5"
            current={now}
            onPick={paint}
          />
        </PanelPart>
      )}
    </>
  )
}

/**
 * The Colour panel of text: the kit's and the design's colours, which take a gradient or an image
 * fill off, and + with any colour, a linear, radial or angular gradient or an image fill, for the
 * texts or the selected characters.
 */
function TextColourPanel({
  target,
  design,
  workspaceId,
  brandId,
  p,
  b,
}: {
  target: Target
  design: Design
  workspaceId: string
  brandId: string
  p: P
  b: Messages['editor']['bar']
}) {
  // What the swatches mark: the colour every selected character shows, or the image.
  const shown = shownTextPaint(target)
  const color = shown === 'mixed' ? shown : shown.type === 'solid' ? shown.color : undefined
  const image = shown !== 'mixed' && shown.type === 'image' ? shown : null
  const paint = (hex: string) => colourTexts(target, hex)
  return (
    <ColourChoices
      editor={target.editor}
      design={design}
      workspaceId={workspaceId}
      brandId={brandId}
      p={p}
      b={b}
      current={color}
      currentImage={image ? assetThumbnail(workspaceId, brandId, image.assetId) : undefined}
      paint={paint}
      onBrand={(token, hex) => (target.range ? paint(hex) : target.editor.bindSelection('color', brandRef(token)))}
      picker={
        <PaintEditor
          paint={firstTextPaint(target)}
          workspaceId={workspaceId}
          brandId={brandId}
          editor={target.editor}
          p={p}
          forText
          colourName={p.textColour}
          onSet={(to) => pickTextPaint(target, to)}
        />
      }
    />
  )
}

/**
 * The Colour panel of shapes and boxes: the kit's and the design's colours, which paint the fill
 * that shows, + with any paint for it, Add image for layers without one, then every fill.
 */
function FillColourPanel({
  target,
  design,
  workspaceId,
  brandId,
  p,
  b,
}: {
  target: Target
  design: Design
  workspaceId: string
  brandId: string
  p: P
  b: Messages['editor']['bar']
}) {
  // The fill a colour paints: the topmost solid one that shows.
  const shown = shared(
    target.props.map((pr) => {
      const fills = (pr.fills ?? []) as Paint[]
      const fill = fills[boundFillIndex(fills)]
      return fill?.type === 'solid' ? fill.color : undefined
    }),
  )
  const paint = (hex: string) =>
    set(target, (now) => {
      const fills = (now.fills ?? []) as Paint[]
      return { fills: changeFill(fills, boundFillIndex(fills), paintColour(hex), NEW_FILL) }
    })
  // The picker edits the topmost fill that shows, whatever its type, so a gradient picked stays the one it shows.
  const pickFill = (to: (now: Paint) => Paint) =>
    set(target, (now) => {
      const fills = (now.fills ?? []) as Paint[]
      return { fills: changeFill(fills, showingFillIndex(fills), to, NEW_FILL) }
    })
  // A picture goes into layers that have none; one that has a picture changes it with Replace in the Image tab.
  const pictureless = target.props.every((pr) => !((pr.fills ?? []) as Paint[]).some((f) => f.type === 'image'))
  const firstFills = (target.props[0].fills ?? []) as Paint[]
  const first = firstFills[showingFillIndex(firstFills)] ?? NEW_FILL
  return (
    <>
      <ColourChoices
        editor={target.editor}
        design={design}
        workspaceId={workspaceId}
        brandId={brandId}
        p={p}
        b={b}
        current={shown}
        paint={paint}
        onBrand={(token) => target.editor.bindSelection('color', brandRef(token))}
        picker={
          <PaintEditor
            paint={first}
            workspaceId={workspaceId}
            brandId={brandId}
            editor={target.editor}
            p={p}
            onSet={pickFill}
          />
        }
      />
      {pictureless && (
        <ImagePickerButton
          workspaceId={workspaceId}
          brandId={brandId}
          title={p.addImageTitle}
          testId="add-image"
          className={PANEL_BUTTON}
          onPick={(asset) => set(target, (now) => ({ fills: withImage((now.fills ?? []) as Paint[], asset.id) }))}
        >
          <ImageSquareIcon size={14} aria-hidden className="shrink-0" />
          <span aria-hidden>{p.addImage}</span>
        </ImagePickerButton>
      )}
      <FillsCard target={target} workspaceId={workspaceId} brandId={brandId} p={p} b={b} />
    </>
  )
}

/**
 * The colours a look card offers: the brand's own, which the layers then follow (change the colour
 * in the kit and they change too), or, with no kit colours, a fixed set painted as it is.
 */
function Swatches({
  workspaceId,
  brandId,
  p,
  current,
  currentImage,
  paint,
  onBrand,
}: {
  workspaceId: string
  brandId: string
  p: P
  current: string | 'mixed' | undefined
  currentImage: string | undefined
  paint: (hex: string) => void
  onBrand?: ((token: string, hex: string) => void) | undefined
}) {
  const kit = useBrandKit(workspaceId, brandId)
  const roles = useMessages().editor.brandKit.brandRoles
  const now = current && current !== 'mixed' ? hexOf(current).toUpperCase() : null
  const colors = inBrandRoleOrder('color', kit?.colors ?? [])
  // The colour it has now leads the row when the row does not hold it, as in the mock, and so does an image it shows.
  const offered = colors.length > 0 ? colors.map((c) => c.value) : SWATCHES
  return (
    <div role="group" aria-label={colors.length > 0 ? p.brandColours : p.colours} className={cn(SWATCH_ROW, 'gap-1.5')}>
      {currentImage && (
        <Swatch
          color="transparent"
          picture={currentImage}
          label={p.currentImage}
          size={PANEL_SWATCH}
          on
          onPick={() => undefined}
        />
      )}
      {now && !holdsColour(offered, now) && (
        <Swatch
          color={now}
          label={format(p.currentColour, { hex: now })}
          size={PANEL_SWATCH}
          on
          onPick={() => undefined}
        />
      )}
      {colors.length > 0
        ? colors.map((c) => (
            <Swatch
              key={c.token}
              color={hexOf(c.value)}
              label={kitEntryName(roles, 'color', c)}
              size={PANEL_SWATCH}
              on={now === hexOf(c.value).toUpperCase()}
              onPick={() => (onBrand ? onBrand(c.token, hexOf(c.value)) : paint(hexOf(c.value)))}
            />
          ))
        : SWATCHES.map((hex) => (
            <Swatch key={hex} color={hex} label={hex} size={PANEL_SWATCH} on={now === hex} onPick={() => paint(hex)} />
          ))}
    </div>
  )
}

/** The fill list, under a heading with +, each fill with its editor. */
function FillBody({
  target,
  workspaceId,
  brandId,
  p,
  title,
}: {
  target: Target
  workspaceId: string
  brandId: string
  p: P
  title: string
}) {
  return (
    <ListBody<Paint>
      title={title}
      p={p}
      target={target}
      field="fills"
      fresh={NEW_FILL}
      onTop={FILL_ON_TOP}
      topFirst
      item={p.fill}
      testId="fill-list"
      render={(paint, n, change) => (
        <PaintRow
          paint={paint}
          name={format(p.colour, { n })}
          workspaceId={workspaceId}
          brandId={brandId}
          editor={target.editor}
          p={p}
          onSet={change}
        />
      )}
    />
  )
}
