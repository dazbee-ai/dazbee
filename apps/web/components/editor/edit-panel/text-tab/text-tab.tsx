'use client'

// The Text switcher tab's sections. Font: the font, which opens the font chooser in the edit
// panel's place, then the size and the four text styles; mixed layers show only the font of the
// texts among them, with no heading as the tab's one part. Paragraph: alignment, direction,
// vertical place, list and case. Spacing: the room between lines, letters and paragraphs, the box,
// shrink to fit and the most lines. Font features: the OpenType features its fonts have. While a
// text is being edited, the size, styles, case, letter spacing and features set the selected run's,
// as its keys do. A locked text's controls are all turned off, saying why.
import { PanelPart } from '@/components/editor/edit-panel/fields.tsx'
import type { Control } from '@/components/editor/edit-panel/tabs/tabs.ts'
import { factsOf, type PanelProps, shared, type Style, type Target } from '@/components/editor/edit-panel/target.ts'
import { FONT_CHOOSER, setOpen } from '@/components/editor/edit-store.ts'
import { PANEL_BUTTON, PANEL_PART } from '@/components/editor/styles.ts'
import { ViewOnlyFieldset } from '@/components/editor/view-only.tsx'
import { CaretRightIcon } from '@/components/ui/icons.tsx'
import { cn } from '@/lib/cn.ts'
import { useMessages } from '@/lib/i18n/client.tsx'
import { format } from '@/lib/i18n/index.ts'

import { FeatureRows } from './features.tsx'
import { ParagraphRows } from './paragraph.tsx'
import { SizeStepper } from './size-stepper.tsx'
import { SpacingParts } from './spacing.tsx'
import { TextStyles } from './text-styles.tsx'

/** What a section of the Text switcher tab is given: the selection, and the controls it shows. */
export interface SectionProps extends PanelProps {
  controls: Control[]
}

/** The text styles of the selection's texts: the selected run's while one is being edited. */
const stylesOfTexts = (target: Target) =>
  target.range ?? target.props.flatMap((pr, i) => (target.types[i] === 'text' ? [pr.style as Style] : []))

/** Whether any of the selected layers is locked, which turns a section's controls off. */
const anyLocked = ({ target, design }: PanelProps) => factsOf(target, design).locked.length > 0

/**
 * The Font section: the font, and for texts alone the size and the four text styles. With only the
 * font, as for mixed layers, it is the switcher tab's one part, so it has no heading of its own.
 */
export function FontSection({ controls, ...props }: SectionProps) {
  const t = useMessages()
  const { target } = props
  const why = anyLocked(props) ? t.editor.bar.lockedRow : null
  const body = (
    <ViewOnlyFieldset off={why !== null}>
      <FontField target={target} />
      {(controls.includes('size') || controls.includes('text-style')) && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          {controls.includes('size') && <SizeStepper target={target} />}
          {controls.includes('text-style') && <TextStyles target={target} />}
        </div>
      )}
    </ViewOnlyFieldset>
  )
  if (controls.length === 1)
    return (
      <section aria-label={t.editor.editPanel.sections.font} data-testid="font-section" className={PANEL_PART}>
        {why && <p className="text-caption font-medium text-muted">{why}</p>}
        {body}
      </section>
    )
  return (
    <PanelPart id="font-section" title={t.editor.editPanel.sections.font} {...(why && { note: why })}>
      {body}
    </PanelPart>
  )
}

/** The Paragraph section: alignment, direction, vertical place, list and case. */
export function ParagraphSection(props: SectionProps) {
  const t = useMessages()
  const why = anyLocked(props) ? t.editor.bar.lockedRow : null
  return (
    <PanelPart id="paragraph-section" title={t.editor.editPanel.sections.paragraph} {...(why && { note: why })}>
      <ViewOnlyFieldset off={why !== null}>
        <ParagraphRows target={props.target} />
      </ViewOnlyFieldset>
    </PanelPart>
  )
}

/** The Spacing section: the room between lines, letters and paragraphs, the box, and its fit: shrink to fit and the most lines. */
export function SpacingSection(props: SectionProps) {
  return (
    // Its parts sit in the fieldset, so the first keeps the line over it that parts of a panel have between them.
    <ViewOnlyFieldset off={anyLocked(props)} className="[&>:first-child]:border-t [&>:first-child]:pt-3">
      <SpacingParts target={props.target} />
    </ViewOnlyFieldset>
  )
}

/** The Font features section: a switch for each OpenType feature the texts' fonts have. */
export function FeaturesSection(props: SectionProps) {
  const t = useMessages()
  const why = anyLocked(props) ? t.editor.bar.lockedRow : null
  return (
    <PanelPart id="features-section" title={t.editor.editPanel.sections.features} {...(why && { note: why })}>
      <ViewOnlyFieldset off={why !== null}>
        <FeatureRows target={props.target} />
      </ViewOnlyFieldset>
    </PanelPart>
  )
}

/**
 * The font field: the texts' family, or Mixed where they differ, opening the font chooser in the
 * edit panel's place, whose back arrow returns here.
 */
function FontField({ target }: { target: Target }) {
  const t = useMessages()
  const family = shared(stylesOfTexts(target).map((style) => style.fontFamily))
  const name = family === 'mixed' ? t.editor.fonts.mixed : family
  return (
    <button
      type="button"
      data-opens={FONT_CHOOSER}
      data-testid="font-field"
      aria-label={format(t.editor.editPanel.fontIs, { font: name })}
      onClick={() => setOpen(FONT_CHOOSER)}
      className={cn(PANEL_BUTTON, 'w-full justify-between')}
    >
      <span>{name}</span>
      <CaretRightIcon size={13} aria-hidden className="shrink-0 text-subtle rtl:-scale-x-100" />
    </button>
  )
}
