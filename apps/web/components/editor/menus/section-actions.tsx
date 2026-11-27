'use client'

// A picked section's actions, one list for its card in the edit panel and the right-click menu on its
// title or outline: on a brief's section Edit brief first, which opens the brief box filled with its brief, so Enter
// runs it changed as a new section; then Rename, Ungroup, which keeps its frames where they are, Duplicate, which copies
// it beside itself and picks the copy, and Delete section and frames, the last after a line and in
// the danger colour. Each is one undo step, with no dialog. A tab that may only view has none.
import type { RefObject } from 'react'

import type { Editor } from '@dazbee/editor'
import type { DesignAi } from '@dazbee/schema'

import { setFlyout, setRenameOpener } from '@/components/editor/edit-store.ts'
import { useDesignAi } from '@/components/editor/editor-hooks.ts'
import { useViewOnly } from '@/components/editor/view-only.tsx'
import { MenuDivider, MenuItem } from '@/components/ui/menu.tsx'
import { BRIEF_DRAFTS, briefDraftOf, briefOfSection } from '@/lib/editor/brief-draft.ts'
import { keyOf } from '@/lib/editor/shortcut-keys.ts'
import { useMessages } from '@/lib/i18n/client.tsx'
import { format } from '@/lib/i18n/index.ts'

/** What each of a section's actions does, by its name. */
export type SectionAction = 'editBrief' | 'rename' | 'ungroup' | 'duplicate' | 'deleteWithFrames'

/** The actions in the order they are listed, the last after a line. */
export const SECTION_ACTIONS: readonly SectionAction[] = ['rename', 'ungroup', 'duplicate', 'deleteWithFrames']

/** The actions of section `sectionId` in the order listed: Edit brief first on a brief's section, as `ai` last read. */
export function sectionActionsOf(ai: DesignAi | null, sectionId: string): readonly SectionAction[] {
  return briefOfSection(ai, sectionId) ? ['editBrief', ...SECTION_ACTIONS] : SECTION_ACTIONS
}

/** Names a brief's pictures by their place from 0, in the words `named` gives: "Picture 1" on. */
export function pictureNamer(named: string): (n: number) => string {
  return (n) => format(named, { n: n + 1 })
}

/**
 * Runs one of a section's actions. Rename gives the focus back to `opener`, the button it was asked
 * from, once its field closes from the keyboard; null when asked from the stage.
 */
export function runSectionAction(
  editor: Editor,
  sectionId: string,
  action: SectionAction,
  pictureName: (n: number) => string,
  opener: HTMLElement | null = null,
) {
  if (action === 'editBrief') {
    const brief = briefOfSection(editor.designAi(), sectionId)
    if (!brief) return
    BRIEF_DRAFTS.fill(editor, briefDraftOf(brief, pictureName))
    setFlyout('ai')
  } else if (action === 'rename') {
    setRenameOpener(opener)
    editor.renameSection(sectionId)
  } else if (action === 'ungroup') editor.session.run('section.ungroup', { sectionId })
  else if (action === 'duplicate') {
    // As Ctrl+D on the picked section: the copy is picked and shown.
    editor.pickSection(sectionId)
    editor.perform('duplicate')
  } else editor.session.run('section.delete', { sectionId })
}

/** The section's action rows of a menu, each running what its key runs where it has one. */
export function SectionActions({
  editor,
  sectionId,
  opener,
}: {
  editor: Editor
  sectionId: string
  opener?: RefObject<HTMLElement | null>
}) {
  const t = useMessages()
  const s = t.editor.sections
  const viewOnly = useViewOnly()
  const ai = useDesignAi(editor)
  if (viewOnly) return null
  const run = (action: SectionAction) =>
    runSectionAction(editor, sectionId, action, pictureNamer(t.editor.brief.pictureName), opener?.current ?? null)
  return (
    <>
      {briefOfSection(ai, sectionId) && (
        <MenuItem action="editBrief" label={s.editBrief} onSelect={() => run('editBrief')} />
      )}
      <MenuItem action="rename" label={s.rename} keys={keyOf('rename')} onSelect={() => run('rename')} />
      <MenuItem action="ungroup" label={s.ungroup} keys={keyOf('delete')} onSelect={() => run('ungroup')} />
      <MenuItem action="duplicate" label={s.duplicate} keys={keyOf('duplicate')} onSelect={() => run('duplicate')} />
      <MenuDivider />
      <MenuItem action="delete" label={s.deleteWithFrames} danger onSelect={() => run('deleteWithFrames')} />
    </>
  )
}
