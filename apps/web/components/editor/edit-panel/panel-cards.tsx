'use client'

// Which card the edit panel shows, and the cards for the selection: the picked frame's, the picked
// section's (`section/section-panel.tsx`), the selected layers', and the font chooser in the panel's place.
import type { ReactNode } from 'react'

import type { Editor } from '@dazbee/editor'

import { useFontCatalog } from '@/components/brand-kit/font-catalog.ts'
import { LineUpSection, OrderSection, PositionSection } from '@/components/editor/edit-panel/arrange/arrange.tsx'
import { WrapInSection } from '@/components/editor/edit-panel/arrange/wrap-in.tsx'
import { BackgroundSection } from '@/components/editor/edit-panel/frame/background.tsx'
import { FrameMore } from '@/components/editor/edit-panel/frame/frame-more.tsx'
import { FramePositionSection } from '@/components/editor/edit-panel/frame/position.tsx'
import type { FrameSectionProps } from '@/components/editor/edit-panel/frame/types.ts'
import { EditSection, FitSection, PhotoSection } from '@/components/editor/edit-panel/image-tab/image-tab.tsx'
import { SectionPanel } from '@/components/editor/edit-panel/section/section-panel.tsx'
import { PanelHeader } from '@/components/editor/edit-panel/tabs/panel-header.tsx'
import { STYLE_SECTION_PARTS } from '@/components/editor/edit-panel/tabs/style-sections.tsx'
import {
  framePanelOf,
  type FrameSectionId,
  type PanelLayout,
  panelOf,
  type Section,
  type SectionProps,
} from '@/components/editor/edit-panel/tabs/tabs.ts'
import { TEXT_SECTIONS } from '@/components/editor/edit-panel/text-tab/text-tab.tsx'
import {
  FONT_CHOOSER,
  panelFor,
  selectionPanelShows,
  useEditState,
  useSelectionFollower,
} from '@/components/editor/edit-store.ts'
import { usePickedFrame, usePickedSection, useSelection } from '@/components/editor/editor-hooks.ts'
import { FontChooser } from '@/components/editor/fonts/font-chooser.tsx'
import { useLiveDesign } from '@/components/editor/use-live-design.ts'
import { useViewOnly, ViewOnlyFieldset } from '@/components/editor/view-only.tsx'
import { useMessages } from '@/lib/i18n/client.tsx'
import { format, type Messages } from '@/lib/i18n/index.ts'

import { closePanel, PanelFrame, SelectionPanel } from './edit-panel.tsx'
import { LayoutSection } from './layout-section.tsx'
import { CombineSection, CombineShapesSection, ShapeSection } from './shape-sections.tsx'
import { usePressWatch, useSheetClear } from './sheet-clear.ts'
import { useEditSheet } from './sheet-heights.ts'
import { factsOf, kindOf, type PanelProps, type Target, useTarget } from './target.ts'

/** What each section of a switcher tab holds for the selection, by the section's id. */
const SECTIONS: Record<Section['id'], (props: SectionProps) => ReactNode> = {
  ...TEXT_SECTIONS,
  position: PositionSection,
  order: OrderSection,
  'line-up': LineUpSection,
  'wrap-in': WrapInSection,
  shape: ShapeSection,
  combine: CombineSection,
  'combine-shapes': CombineShapesSection,
  layout: LayoutSection,
  photo: PhotoSection,
  fit: FitSection,
  edit: EditSection,
  ...STYLE_SECTION_PARTS,
}
/** What each section of a switcher tab holds for the picked frame, by the section's id. */
const FRAME_SECTIONS: Record<FrameSectionId, (props: FrameSectionProps) => ReactNode> = {
  background: BackgroundSection,
  'frame-position': FramePositionSection,
}

/** What the selected layers are called: the layer's name, or how many layers. */
const layersName = (target: Target, p: Messages['editor']['props']) =>
  target.ids.length > 1 ? format(p.layers, { n: target.ids.length }) : target.names[0] || p.layer

/**
 * The edit panel, following the selection: open while layers are selected or a frame or section is picked,
 * unless the font chooser or a design card takes its place, which a change of selection closes.
 */
export function EditPanel({ editor, workspaceId, brandId }: { editor: Editor; workspaceId: string; brandId: string }) {
  const { open } = useEditState()
  const viewOnly = useViewOnly()
  const ids = useSelection(editor)
  const picked = usePickedFrame(editor)
  const section = usePickedSection(editor)
  useSelectionFollower(ids, picked ?? (section === null ? null : `section ${section}`))
  usePressWatch()
  useSheetClear(editor, ids, useEditSheet())
  const selected = useTarget(editor, ids)
  const shows = panelFor(selected !== null, picked)
  if (shows === 'frame' && picked)
    return <FramePanel editor={editor} frameId={picked} workspaceId={workspaceId} brandId={brandId} />
  if (!selected && section) return <SectionPanel editor={editor} sectionId={section} />
  if (!selected) return null
  const { target, design } = selected
  if (open === FONT_CHOOSER)
    return <FontPanel target={target} design={design} workspaceId={workspaceId} brandId={brandId} />
  const facts = factsOf(target, design)
  const layout = panelOf({ kind: kindOf(target), facts, several: target.ids.length > 1, viewOnly })
  if (!selectionPanelShows(open, layout.switcherTabs.length > 0)) return null
  return <LayersPanel {...{ target, design, workspaceId, brandId, layout }} locked={facts.locked} />
}

/**
 * The edit panel for the picked frame, while nothing takes its place: its name and ⋯, then
 * Background and Arrange. None once the frame is gone, as a frame duplicated a moment ago is picked
 * before the design that holds it is drawn. Picking another frame keeps the panel, and the ⋯ the
 * focus may be on.
 */
function FramePanel({ editor, frameId, workspaceId, brandId }: Omit<FrameSectionProps, 'design'>) {
  const { open } = useEditState()
  const viewOnly = useViewOnly()
  const { design } = useLiveDesign(editor)
  const frame = design.frames[frameId]
  if (!frame || !selectionPanelShows(open, true)) return null
  const layout = framePanelOf({ viewOnly })
  return (
    <SelectionPanel
      editor={editor}
      layout={layout}
      named={{ 'data-frame': frameId }}
      header={
        <PanelHeader editor={editor} name={frame.name} controls={layout.header}>
          {layout.header.includes('frame-more') && <FrameMore editor={editor} frameId={frameId} design={design} />}
        </PanelHeader>
      }
      section={(section) => {
        const Content = FRAME_SECTIONS[section.id]
        // Keyed by the frame too, so what a section holds for one frame, as Lock ratio, starts afresh for another.
        return (
          <Content
            key={`${section.id} ${frameId}`}
            editor={editor}
            design={design}
            frameId={frameId}
            workspaceId={workspaceId}
            brandId={brandId}
          />
        )
      }}
    />
  )
}

/**
 * The font chooser, in the edit panel's place: its back arrow, or Esc, returns to the Text switcher
 * tab, the focus to its font. The chooser's search takes the focus as it opens.
 */
function FontPanel({ target, workspaceId, brandId }: PanelProps) {
  const { bar, editPanel } = useMessages().editor
  const { catalog, fetched, refresh } = useFontCatalog(workspaceId, brandId)
  return (
    <PanelFrame id={FONT_CHOOSER} title={bar.panels.font} focus={false} back={editPanel.backToText} fills>
      <ViewOnlyFieldset>
        <FontChooser
          editor={target.editor}
          workspaceId={workspaceId}
          brandId={brandId}
          catalog={catalog}
          fetched={fetched}
          refresh={refresh}
          onDone={() => closePanel(FONT_CHOOSER, true)}
        />
      </ViewOnlyFieldset>
    </PanelFrame>
  )
}

/** The edit panel for the selected layers: their name and lock, then their sections. */
function LayersPanel({
  layout,
  locked,
  ...props
}: PanelProps & {
  layout: PanelLayout
  /** The selected layers that are locked, which the header's lock unlocks. */
  locked: string[]
}) {
  const { target } = props
  const t = useMessages()
  return (
    <SelectionPanel
      editor={target.editor}
      layout={layout}
      named={{ 'data-selection': target.ids.join(' ') }}
      header={
        <PanelHeader
          editor={target.editor}
          name={layersName(target, t.editor.props)}
          controls={layout.header}
          locked={locked}
        />
      }
      section={(section, headed) => {
        const Content = SECTIONS[section.id]
        // Keyed by the layers too, so what a section shows open for some layers starts afresh for others.
        return (
          <Content key={[section.id, ...target.ids].join(' ')} {...props} controls={section.controls} headed={headed} />
        )
      }}
    />
  )
}
