'use client'

// The right-click menu on the stage: the layer actions for the layer the right-click picked, under
// Select layer ▸, the list of the layers under the pointer when two or more lie there; the frame's
// actions for the frame it picked by its empty area or its label, the rows of the picked frame's ⋯;
// the section's actions for the section it picked by its title or outline line (`section-actions.tsx`);
// or, outside every frame, Show hidden layers alone. Each ends with Show hidden layers after a line
// while the design has hidden layers or they show, ticked while they show: it turns the view on
// or off, never the layers. It opens at the right-click, or on a phone as the sheet at the bottom
// of the screen, as the full menu does.
import { type ReactElement, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

import type { Editor, LayerAt, Point } from '@dazbee/editor'

import { flyoutReach, menuStartInset } from '@/components/editor/chrome.ts'
import { setRightClick, useEditState } from '@/components/editor/edit-store.ts'
import {
  useEditorDesign,
  useHiddenShown,
  usePickedFrame,
  usePickedSection,
  useSelection,
  useShownPage,
} from '@/components/editor/editor-hooks.ts'
import { LayerPicture, pictured } from '@/components/editor/flyouts/layer-picture.tsx'
import { ROW_SELECTED } from '@/components/editor/flyouts/tree-row.tsx'
import { useLayerPictures } from '@/components/editor/flyouts/use-layer-pictures.ts'
import { isLocked } from '@/components/editor/layer-looks.ts'
import { CheckIcon, LockSimpleIcon } from '@/components/ui/icons.tsx'
import { MENU_EDGE, MenuDivider, MenuItem, MenuSub, RightClickMenu } from '@/components/ui/menu.tsx'
import { cn } from '@/lib/cn.ts'
import { useLocale, useMessages } from '@/lib/i18n/client.tsx'
import { dirOf } from '@/lib/i18n/index.ts'

import { FrameActions } from './frame-actions.tsx'
import { LayerActions } from './layer-actions.tsx'
import { SectionActions } from './section-actions.tsx'
import type { StageMenuOpen } from './stage-menu-at.ts'

/** The most layers Select layer lists, front-most first. */
export const LISTED_LAYERS = 40
/** How far each level of nesting indents a layer in Select layer's list, in pixels, and the deepest level it shows. */
const INDENT = 12
const DEEPEST = 8
/** How wide each kind of menu is. */
const MENU_WIDTH: Record<StageMenuOpen['on'], string> = {
  frame: 'min-w-56',
  section: 'min-w-56',
  canvas: 'min-w-52',
  layer: 'w-80',
}

/**
 * How far from the window's start edge the menu keeps: past the open flyout when the room past
 * it, on the side of the right-click it opens or the other, holds it, else MENU_EDGE from the edge,
 * over the flyout. Measured once the menu shows, and again as the flyout changes.
 */
function useStartInset(at: Point | null, rtl: boolean, flyoutEnd: number | null) {
  const [inset, setInset] = useState(MENU_EDGE)
  // Bumped while the menu is open but not yet in the page: its portal puts it there a render later.
  const [looked, setLooked] = useState(0)
  useLayoutEffect(() => {
    // Closed, it starts again from the window's edge, so its rows first measure the most room they could have.
    if (!at) return setInset(MENU_EDGE)
    const content = document.querySelector<HTMLElement>('[data-testid="stage-menu"]')
    if (!content) {
      const frame = requestAnimationFrame(() => setLooked((n) => n + 1))
      return () => cancelAnimationFrame(frame)
    }
    const width = document.documentElement.clientWidth
    const reach = flyoutReach(rtl)
    const x = rtl ? width - at.x : at.x
    setInset(menuStartInset(reach, Math.max(width - MENU_EDGE - x, x - reach), content.offsetWidth))
  }, [at, rtl, flyoutEnd, looked])
  return inset
}

/**
 * The layers whose rows show in the list's view, in the order they came into it, by the element
 * of each row that `watch` is given, named by its `data-layer`; `scrolledAt` is when the rows in
 * view last changed after the first count, as the list scrolled.
 */
function useRowsInView() {
  const [inView, setInView] = useState<string[]>([])
  const scrolledAt = useRef(0)
  const observer = useRef<IntersectionObserver | null>(null)
  const counted = useRef(false)
  const watch = useCallback((element: HTMLElement | null) => {
    if (!element) return
    observer.current ??= new IntersectionObserver((entries) => {
      if (counted.current) scrolledAt.current = performance.now()
      counted.current = true
      setInView((now) => {
        const next = new Set(now)
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).dataset.layer ?? ''
          if (entry.isIntersecting) next.add(id)
          else next.delete(id)
        }
        return [...next]
      })
    })
    observer.current.observe(element)
    return () => observer.current?.unobserve(element)
  }, [])
  return { inView, scrolledAt, watch }
}

/**
 * The menu at a right-click on the stage's canvas (`children`): the layer actions for the layer it
 * picked, the frame's actions for the frame it picked, or Show hidden layers outside every frame;
 * it shows while the stage has a menu open (`menu`), which the canvas's
 * own right-click opens, and closes once the selection or the picked frame changes, a row runs, or
 * Esc or a press elsewhere closes it.
 */
export function StageMenu({
  editor,
  menu,
  onClose,
  children,
}: {
  editor: Editor | null
  /**
   * The menu open at the last right-click, with the frame whose actions it shows, the layers under
   * it, front-most first, and whether it offers Show hidden layers; null while none is.
   */
  menu: StageMenuOpen | null
  onClose: () => void
  children: ReactElement
}) {
  const t = useMessages().editor
  const rtl = dirOf(useLocale()) === 'rtl'
  const { islandsBottom, flyoutEnd } = useEditState()
  const start = useStartInset(menu?.at ?? null, rtl, flyoutEnd)
  const kind = menu?.on ?? 'layer'
  return (
    <RightClickMenu
      area={children}
      open={menu !== null}
      onOpenChange={(to) => {
        if (!to) onClose()
      }}
      label={
        { frame: t.frames.more, section: t.sections.actions, canvas: t.bar.canvasMenu, layer: t.bar.actions }[kind]
      }
      testId="stage-menu"
      sheet
      // Kept between the top islands and the bottom controls, scrolling inside when it has less room, and
      // off the open flyout at its start side.
      place={{
        sticky: 'always',
        collisionPadding: {
          top: islandsBottom + 8,
          bottom: 72,
          left: rtl ? MENU_EDGE : start,
          right: rtl ? start : MENU_EDGE,
        },
      }}
      className={MENU_WIDTH[kind]}
    >
      {editor && menu && <StageMenuRows editor={editor} menu={menu} onClose={onClose} />}
    </RightClickMenu>
  )
}

/** The rows of the stage's open right-click menu, closing it once the selection or the picked frame changes. */
function StageMenuRows({ editor, menu, onClose }: { editor: Editor; menu: StageMenuOpen; onClose: () => void }) {
  const { on, frameId, sectionId, hidden, layers } = menu
  const ids = useSelection(editor)
  const pickedFrame = usePickedFrame(editor)
  const pickedSection = usePickedSection(editor)
  const picked = pickedFrame ?? pickedSection
  const [openedFor] = useState(ids)
  const [pickedFor] = useState(picked)
  useEffect(() => {
    if (ids !== openedFor || picked !== pickedFor) onClose()
  }, [ids, openedFor, picked, pickedFor, onClose])
  // The shell hides the tab bar and the dock under it on a phone, as under every sheet.
  useEffect(() => {
    setRightClick(true)
    return () => setRightClick(false)
  }, [])
  if (on === 'canvas') return <ShowHidden editor={editor} onClose={onClose} />
  return (
    <>
      {on === 'section' && sectionId ? (
        <SectionActions editor={editor} sectionId={sectionId} />
      ) : on === 'frame' && frameId ? (
        <FrameRows editor={editor} frameId={frameId} />
      ) : (
        <>
          {layers.length >= 2 && (
            <>
              <SelectLayer editor={editor} layers={layers} selected={ids} />
              <MenuDivider />
            </>
          )}
          <LayerActions editor={editor} ids={ids} onDone={onClose} />
        </>
      )}
      {hidden && (
        <>
          <MenuDivider />
          <ShowHidden editor={editor} onClose={onClose} />
        </>
      )}
    </>
  )
}

/**
 * Show hidden layers, ticked while they show: turns this tab's view of them on or off, writing
 * nothing to the design, and closes the menu.
 */
function ShowHidden({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const b = useMessages().editor.bar
  const shown = useHiddenShown(editor)
  return (
    <MenuItem
      action="toggleHiddenShown"
      label={b.showHidden}
      checked={shown}
      onSelect={() => {
        editor.setHiddenShown(!shown)
        onClose()
      }}
    >
      {b.showHidden}
      <CheckIcon size={14} aria-hidden className="invisible shrink-0 group-aria-checked:visible" />
    </MenuItem>
  )
}

/**
 * The frame's actions, as its ⋯ in the edit panel's header lists them. Rename and Export are asked
 * from the stage: the focus goes back as after a rename from the frame's label, and Export's Esc
 * gives it to Share.
 */
function FrameRows({ editor, frameId }: { editor: Editor; frameId: string }) {
  const { design } = useEditorDesign(editor)
  return <FrameActions editor={editor} frameId={frameId} design={design} />
}

/**
 * Select layer ▸: the layers under the right-click, front-most first, each indented by how deep it
 * is, with the picture and name its layers panel row shows, a selected one's row lit as the panel
 * lights it and read as the current one, and marked while locked. Pictures are asked for only for
 * the rows in view, as the panel asks for its rows'. Picking one selects it as the layers panel would,
 * going into its group, which closes the menu.
 */
function SelectLayer({ editor, layers, selected }: { editor: Editor; layers: LayerAt[]; selected: string[] }) {
  const t = useMessages().editor
  const design = editor.design()
  const { inView, scrolledAt, watch } = useRowsInView()
  const pictures = useLayerPictures(
    editor,
    useShownPage(editor),
    inView.filter((id) => {
      const node = design.nodes[id]
      return node !== undefined && pictured(node)
    }),
    scrolledAt,
  )
  return (
    <MenuSub label={t.actions.selectLayer} testId="select-layer" wide>
      {layers.slice(0, LISTED_LAYERS).map((layer) => {
        const node = design.nodes[layer.id]
        if (!node) return null
        const current = selected.includes(layer.id)
        const locked = isLocked(node)
        return (
          <MenuItem
            key={layer.id}
            action="selectLayer"
            label={node.name}
            current={current}
            onSelect={() => editor.pickLayer(layer)}
            className={cn('justify-start gap-2', current && ROW_SELECTED)}
          >
            <span
              aria-hidden
              data-indent
              style={{ width: INDENT * Math.min(layer.depth, DEEPEST) }}
              className="shrink-0"
            />
            <LayerPicture node={node} picture={pictures[layer.id] ?? null} selected={current} />
            <span ref={watch} data-name data-layer={layer.id} className="min-w-0 flex-1 truncate">
              {node.name}
            </span>
            {locked && (
              <LockSimpleIcon data-locked size={13} aria-label={t.bar.lockedLayer} className="shrink-0 text-subtle" />
            )}
          </MenuItem>
        )
      })}
    </MenuSub>
  )
}
