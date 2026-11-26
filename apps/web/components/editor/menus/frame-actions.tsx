'use client'

// A frame's actions, one list for the picked frame's ⋯ in the edit panel's header and the right-click
// menu on the frame: Duplicate, Add size ▸, which opens the Add size card in the panel's place,
// Rename, Star or Unstar, Export, which opens the Share menu's Export with this frame ticked alone,
// Copy as PNG, Remove guides while the frame has guides, and Delete, the last after a line and in
// the danger colour. A tab that may only view keeps Export and Copy as PNG alone (C35).
import type { RefObject } from 'react'

import type { Editor } from '@dazbee/editor'
import { type Design, hasGuides } from '@dazbee/schema'

import { askExport, setOpen, setRenameOpener } from '@/components/editor/edit-store.ts'
import { useViewOnly } from '@/components/editor/view-only.tsx'
import { MenuDivider, MenuItem } from '@/components/ui/menu.tsx'
import { keyOf } from '@/lib/editor/shortcut-keys.ts'
import { useMessages } from '@/lib/i18n/client.tsx'

/**
 * The frame's action rows, each running what its shortcut runs. Rename and Export give the focus
 * back to `opener`, the menu's button they were asked from; with none, as asked from the stage.
 */
export function FrameActions({
  editor,
  frameId,
  design,
  opener,
}: {
  editor: Editor
  frameId: string
  design: Design
  opener?: RefObject<HTMLElement | null>
}) {
  const t = useMessages()
  const f = t.editor.frames
  const viewOnly = useViewOnly()
  const from = () => opener?.current ?? null
  const starred = design.frames[frameId]?.starred === true
  return (
    <>
      {!viewOnly && (
        <MenuItem
          action="duplicate"
          label={t.editor.actions.duplicate}
          keys={keyOf('duplicate')}
          onSelect={() => editor.perform('duplicate')}
        />
      )}
      {!viewOnly && <MenuItem action="add-size" label={f.addSize} caret onSelect={() => setOpen('addSize')} />}
      {!viewOnly && (
        <MenuItem
          action="rename"
          label={f.rename}
          onSelect={() => {
            setRenameOpener(from())
            editor.renameFrame(frameId)
          }}
        />
      )}
      {!viewOnly && (
        <MenuItem
          action="star"
          label={starred ? f.unstar : f.star}
          onSelect={() => editor.session.run('frame.update', { frameId, starred: !starred })}
        />
      )}
      <MenuItem action="export" label={f.export} onSelect={() => askExport([frameId], from())} />
      <MenuItem
        action="copyPng"
        label={t.editor.actions.copyPng}
        keys={keyOf('copyPng')}
        onSelect={() => editor.copyPng()}
      />
      {!viewOnly && hasGuides(design.frames[frameId]) && (
        <MenuItem
          action="remove-guides"
          label={f.removeGuides}
          onSelect={() => editor.session.run('guide.clear', { frameId })}
        />
      )}
      {!viewOnly && <MenuDivider />}
      {!viewOnly && (
        <MenuItem
          action="delete"
          label={t.editor.actions.delete}
          keys={keyOf('delete')}
          danger
          onSelect={() => editor.perform('delete')}
        />
      )}
    </>
  )
}
