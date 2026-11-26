'use client'

// The edit panel for the picked connector: what it joins, from the frame or section it starts from
// to the one it points to ("Feed 1 → Story versions"), and Delete, one undo step with no dialog.
// None once the connector or an end of it is gone.
import type { Editor } from '@dazbee/editor'
import type { Design } from '@dazbee/schema'

import { SelectionPanel } from '@/components/editor/edit-panel/edit-panel.tsx'
import { PanelHeader } from '@/components/editor/edit-panel/tabs/panel-header.tsx'
import type { PanelLayout } from '@/components/editor/edit-panel/tabs/tabs.ts'
import { selectionPanelShows, useEditState } from '@/components/editor/edit-store.ts'
import { PANEL_BUTTON } from '@/components/editor/styles.ts'
import { useLiveDesign } from '@/components/editor/use-live-design.ts'
import { useViewOnly } from '@/components/editor/view-only.tsx'
import { cn } from '@/lib/cn.ts'
import { useMessages } from '@/lib/i18n/client.tsx'
import { format } from '@/lib/i18n/index.ts'

/** The panel's one switcher tab, which shows no switcher: what the connector joins, and Delete. */
const LAYOUT: PanelLayout<'connector-actions'> = {
  header: [],
  switcherTabs: [{ id: 'arrange', sections: [{ id: 'connector-actions', controls: [] }] }],
}

/** The name of a connector's end: a frame's name or a section's title; undefined for one gone. */
function endName(design: Design, id: string) {
  if (Object.hasOwn(design.frames, id)) return design.frames[id]?.name
  return Object.hasOwn(design.sections, id) ? design.sections[id]?.title : undefined
}

export function ConnectorPanel({ editor, connectorId }: { editor: Editor; connectorId: string }) {
  const { open } = useEditState()
  const c = useMessages().editor.connectors
  const { design } = useLiveDesign(editor)
  const connector = Object.hasOwn(design.connectors, connectorId) ? design.connectors[connectorId] : undefined
  const from = connector && endName(design, connector.from)
  const to = connector && endName(design, connector.to)
  if (from === undefined || to === undefined || !selectionPanelShows(open, true)) return null
  return (
    <SelectionPanel
      editor={editor}
      layout={LAYOUT}
      named={{ 'data-connector': connectorId }}
      header={<PanelHeader editor={editor} name={c.connector} controls={[]} />}
      section={() => (
        <ConnectorCard
          key={connectorId}
          editor={editor}
          connectorId={connectorId}
          joins={format(c.joins, { from, to })}
        />
      )}
    />
  )
}

/** What the connector joins, and its Delete in the danger colour. */
function ConnectorCard({ editor, connectorId, joins }: { editor: Editor; connectorId: string; joins: string }) {
  const c = useMessages().editor.connectors
  const viewOnly = useViewOnly()
  return (
    <div className="flex flex-col gap-1.5" data-testid="connector-actions">
      <p className="truncate text-caption text-muted" title={joins}>
        {joins}
      </p>
      {!viewOnly && (
        <button
          type="button"
          data-action="delete"
          onClick={() => editor.session.run('connector.delete', { connectorId })}
          className={cn(PANEL_BUTTON, 'text-danger')}
        >
          <span>{c.delete}</span>
        </button>
      )}
    </div>
  )
}
