'use client'

// The field that renames a section in place of its title on the stage: a double click on the title,
// F2, Rename in its menus, or a section just made with the Section tool opens it with the title
// selected, in the title's own place, see-through as the title is, with an accent line under it. The
// editor leaves the title out meanwhile. Enter or leaving it keeps the new title, as one undo step;
// Escape keeps the old one. It follows the title as the view moves, and ends once the section is gone.
import { useEffect, useState } from 'react'

import type { Editor } from '@dazbee/editor'
import { MAX_SECTION_TITLE, type Rect } from '@dazbee/schema'

import { takeRenameOpener } from '@/components/editor/edit-store.ts'
import { useLiveDesign } from '@/components/editor/use-live-design.ts'
import { useViewOnly } from '@/components/editor/view-only.tsx'
import { RenameField } from '@/components/ui/rename-field.tsx'
import { useMessages } from '@/lib/i18n/client.tsx'
import { format } from '@/lib/i18n/index.ts'

/** The section being renamed, and the button it was asked from, which takes the focus back. */
type Renaming = { sectionId: string; opener: HTMLElement | null }

const sameRect = (a: Rect | null, b: Rect | null) =>
  a === b || (a !== null && b !== null && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height)

/**
 * Titles a section what was typed in its rename field, as one undo step: trimmed, and only when it
 * is not empty, differs from the title, and the section is still there. Escape passes null.
 */
export function saveSectionTitle(editor: Editor, sectionId: string, typed: string | null) {
  const title = typed?.trim().slice(0, MAX_SECTION_TITLE).trim()
  const section = editor.design().sections[sectionId]
  if (title && section && title !== section.title) editor.session.run('section.update', { sectionId, title })
}

/** Where the section's title is on the stage, kept current as the view moves and its frames change. */
function useTitleRect(editor: Editor, sectionId: string | null) {
  const [rect, setRect] = useState<Rect | null>(null)
  useEffect(() => {
    if (sectionId === null) return
    const follow = () =>
      setRect((now) => (sameRect(now, editor.titleRect(sectionId)) ? now : editor.titleRect(sectionId)))
    follow()
    const stop = editor.onDraw(follow)
    return () => {
      stop()
    }
  }, [editor, sectionId])
  return sectionId === null ? null : rect
}

export function SectionRename({ editor }: { editor: Editor }) {
  const t = useMessages()
  const [renaming, setRenaming] = useState<Renaming | null>(null)
  const { design } = useLiveDesign(editor)
  const rect = useTitleRect(editor, renaming?.sectionId ?? null)
  useEffect(() => {
    const stop = editor.onSectionRename((sectionId) => setRenaming({ sectionId, opener: takeRenameOpener() }))
    return () => {
      stop()
    }
  }, [editor])
  const section = renaming ? design.sections[renaming.sectionId] : undefined
  // A section another tab deleted ends its rename, and so does the tab turning view-only.
  const viewOnly = useViewOnly()
  useEffect(() => {
    if (!renaming || (section && !viewOnly)) return
    setRenaming(null)
    editor.renamed()
  }, [editor, renaming, section, viewOnly])
  if (!renaming || !section || !rect) return null
  const done = (title: string | null, byKey: boolean) => {
    setRenaming(null)
    editor.renamed()
    saveSectionTitle(editor, renaming.sectionId, title)
    if (byKey) renaming.opener?.focus()
  }
  return (
    <div
      data-testid="section-rename"
      data-section={renaming.sectionId}
      className="absolute z-10 flex"
      style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
    >
      <RenameField
        key={renaming.sectionId}
        name={section.title}
        label={format(t.editor.sections.nameOf, { name: section.title })}
        inputName="section-title"
        maxLength={MAX_SECTION_TITLE}
        // The title's own type, its text at the title's start, with a thin accent line under it.
        className="h-full w-full min-w-0 border-0 bg-transparent p-0 text-[13px] leading-[18px] font-semibold text-accent-text shadow-[inset_0_-1px_0_var(--accent)] outline-none focus-visible:outline-none!"
        onDone={done}
      />
    </div>
  )
}
