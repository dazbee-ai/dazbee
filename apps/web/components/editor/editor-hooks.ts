'use client'

// The hooks that follow the editor: the selection, the picked frame, the design, the page the
// canvas shows and its frames, whether the hidden layers show, the text being edited, and what one
// of the selection's actions would do. Each re-renders its caller when what it follows changes.
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'

import type { Editor, Frame } from '@dazbee/editor'

import { useLiveDesign } from './use-live-design.ts'

/**
 * Whether the tab may only view the design (a Reviewer, or a link that ended), kept current: access
 * can change while the design is open. The page hides or turns off what only writes while it is.
 */
export function useReadOnly(editor: Editor | null) {
  const { subscribe, read } = useMemo(() => readOnlyStore(editor), [editor])
  return useSyncExternalStore(subscribe, read, read)
}

/** What `useReadOnly` follows: the editor's access, read now and told of as it changes; none before the editor runs. */
export function readOnlyStore(editor: Pick<Editor, 'readOnly' | 'onAccess'> | null) {
  return {
    subscribe: (changed: () => void) => editor?.onAccess(changed) ?? (() => {}),
    read: () => editor?.readOnly() ?? false,
  }
}

/** Whether the stage shows the hidden layers, kept current; false before the editor runs. */
export function useHiddenShown(editor: Editor | null) {
  const { subscribe, read } = useMemo(
    () => ({
      subscribe: (changed: () => void) => {
        const stop = editor?.onView(changed)
        return () => {
          stop?.()
        }
      },
      read: () => editor?.hiddenShown() ?? false,
    }),
    [editor],
  )
  return useSyncExternalStore(subscribe, read, read)
}

/** The selected layers, kept current. */
export function useSelection(editor: Editor) {
  const [ids, setIds] = useState(() => editor.selection())
  useEffect(() => {
    const stop = editor.onSelection(setIds)
    return () => {
      stop()
    }
  }, [editor])
  return ids
}

/** The section picked on the stage, or null, following it as it changes. */
export function usePickedSection(editor: Editor) {
  const [picked, setPicked] = useState(() => editor.pickedSection())
  useEffect(() => {
    setPicked(editor.pickedSection())
    const stop = editor.onSectionPick(setPicked)
    return () => {
      stop()
    }
  }, [editor])
  return picked
}

/** The frame picked as a whole, or null, kept current. */
export function usePickedFrame(editor: Editor) {
  const [picked, setPicked] = useState(() => editor.pickedFrame())
  useEffect(() => {
    setPicked(editor.pickedFrame())
    const stop = editor.onFramePick(setPicked)
    return () => {
      stop()
    }
  }, [editor])
  return picked
}

/**
 * The design as the editor holds it, for a panel that shows no layer's place or size: rendered again
 * at the redraw after each change, but once for a drag's moves, as the drag ends.
 */
export function useEditorDesign(editor: Editor) {
  const { design } = useLiveDesign(editor, 'held places')
  return { design }
}

/** The page the canvas shows, kept current: it changes when another page is shown or the shown one is deleted. */
export function useShownPage(editor: Editor) {
  const [page, setPage] = useState(() => editor.shownPage())
  useEffect(() => {
    const follow = () => setPage(editor.shownPage())
    follow()
    const stop = editor.onDraw(follow)
    return () => {
      stop()
    }
  }, [editor])
  return page
}

/** The shown page's frames as last drawn, by order, kept current; the same array while none of them changed. */
export function useShownFrames(editor: Editor) {
  const [frames, setFrames] = useState(() => editor.frames())
  useEffect(() => {
    const follow = () =>
      setFrames((now) => {
        const next = editor.frames()
        return sameFrames(now, next) ? now : next
      })
    follow()
    const stop = editor.onDraw(follow)
    return () => {
      stop()
    }
  }, [editor])
  return frames
}

/** Renders again whenever font files arrive, for what reads the faces a family has, as the text style toggles do. */
export function useFontArrivals(editor: Editor) {
  const [, setVersion] = useState(0)
  useEffect(() => {
    const stop = editor.onFontsArrive(() => setVersion((v) => v + 1))
    return () => {
      stop()
    }
  }, [editor])
}

/** Renders again whenever the text being edited, or its selected range, changes. */
export function useTextSelection(editor: Editor) {
  const [, setVersion] = useState(0)
  useEffect(() => {
    const stop = editor.onTextSelection(() => setVersion((v) => v + 1))
    return () => {
      stop()
    }
  }, [editor])
  return editor.textSelection()
}

/**
 * What one of the selection's actions would do for the selected layers `ids`, or why it has nothing
 * to do, as the editor answers it: Ungroup, the mask item, or Group and the Box action, which wrap
 * alike. The bar and the full menu grey their items by it. Asked again whenever the selection or the
 * design changes, but once for a drag's moves, which change none of them; each caller asks only what
 * it shows, as Ungroup's is tried on a copy of the design.
 */
export function useSelectionState<K extends 'ungroupState' | 'maskState' | 'wrapState'>(
  editor: Editor,
  ids: string[],
  state: K,
) {
  const { version } = useLiveDesign(editor, 'held places')
  const key = ids.join(' ')
  return useMemo(() => editor[state](), [editor, state, version, key]) as ReturnType<Editor[K]>
}

function sameFrames(a: readonly Frame[], b: readonly Frame[]) {
  return (
    a.length === b.length &&
    a.every((frame, i) => {
      const other = b[i]
      return (
        other !== undefined &&
        frame.id === other.id &&
        frame.pageId === other.pageId &&
        frame.name === other.name &&
        frame.x === other.x &&
        frame.y === other.y &&
        frame.width === other.width &&
        frame.height === other.height
      )
    })
  )
}
