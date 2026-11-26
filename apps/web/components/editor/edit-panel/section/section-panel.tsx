'use client'

// The edit panel for the picked section: its title in the header, then its actions as plain buttons,
// Rename, Ungroup, Duplicate and Delete section and frames, each one undo step with no dialog. A tab
// that may only view sees the title alone. None once the section is gone.
import type { Editor } from '@dazbee/editor'

import { SelectionPanel } from '@/components/editor/edit-panel/edit-panel.tsx'
import { PanelHeader } from '@/components/editor/edit-panel/tabs/panel-header.tsx'
import type { PanelLayout } from '@/components/editor/edit-panel/tabs/tabs.ts'
import { selectionPanelShows, useEditState } from '@/components/editor/edit-store.ts'
import { runSectionAction, SECTION_ACTIONS } from '@/components/editor/menus/section-actions.tsx'
import { PANEL_BUTTON } from '@/components/editor/styles.ts'
import { useLiveDesign } from '@/components/editor/use-live-design.ts'
import { useViewOnly } from '@/components/editor/view-only.tsx'
import { cn } from '@/lib/cn.ts'
import { useMessages } from '@/lib/i18n/client.tsx'

/** The panel's one switcher tab, which shows no switcher: the section's actions. */
const LAYOUT: PanelLayout<'section-actions'> = {
  header: [],
  switcherTabs: [{ id: 'arrange', sections: [{ id: 'section-actions', controls: [] }] }],
}

export function SectionPanel({ editor, sectionId }: { editor: Editor; sectionId: string }) {
  const { open } = useEditState()
  const { design } = useLiveDesign(editor)
  const section = design.sections[sectionId]
  if (!section || !selectionPanelShows(open, true)) return null
  return (
    <SelectionPanel
      editor={editor}
      layout={LAYOUT}
      named={{ 'data-section': sectionId }}
      header={<PanelHeader editor={editor} name={section.title} controls={[]} />}
      section={() => <SectionButtons key={sectionId} editor={editor} sectionId={sectionId} />}
    />
  )
}

/** The section's actions, one button each, Delete section and frames last in the danger colour. */
function SectionButtons({ editor, sectionId }: { editor: Editor; sectionId: string }) {
  const s = useMessages().editor.sections
  const viewOnly = useViewOnly()
  if (viewOnly) return null
  return (
    <div className="flex flex-col gap-1.5" data-testid="section-actions">
      {SECTION_ACTIONS.map((action) => (
        <button
          key={action}
          type="button"
          data-action={action}
          onClick={(e) => runSectionAction(editor, sectionId, action, e.currentTarget)}
          className={cn(PANEL_BUTTON, action === 'deleteWithFrames' && 'text-danger')}
        >
          <span>{s[action]}</span>
        </button>
      ))}
    </div>
  )
}
