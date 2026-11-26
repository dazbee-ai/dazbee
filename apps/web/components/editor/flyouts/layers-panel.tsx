'use client'

// The layers panel: one frame of the shown page at a time, named by the frame stepper at its top,
// and that frame's layers as a tree, topmost first, in step with the stage: a picked frame or a
// selection shows its frame, opens the groups it is in and scrolls to its row, and a click on the
// stepper's name picks the frame; Shift and a click on a layer's row select the rows from the last
// one clicked. Drag a layer's row to reorder it or drop it into a group, or onto the stepper to put
// it at the frame's top; rename the frame and layers, lock and hide layers; expand groups. Every
// change is an editor call or a command, so each is one undo step. Only the rows in view are in the
// page, so a frame of hundreds of layers scrolls as smoothly as one of ten.
import { type DragEvent, type KeyboardEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { ancestorsOf, childrenOf } from '@dazbee/doc'
import type { Editor } from '@dazbee/editor'
import { canHold, frameIdOf, framesOf } from '@dazbee/schema'

import { usePickedFrame, useSelection, useShownPage } from '@/components/editor/editor-hooks.ts'
import { useFlyoutNote } from '@/components/editor/flyout-card.tsx'
import { useLiveDesign } from '@/components/editor/use-live-design.ts'
import { useViewOnly } from '@/components/editor/view-only.tsx'
import { EmptyState } from '@/components/ui/empty-state.tsx'
import { useOverlayScroll } from '@/components/ui/overlay-scroll.ts'
import { canStep, nameKey } from '@/lib/editor/frame-stepper.ts'
import { arrowStep, type ClickKeys, opensFor, type Row, rowClick, treeRows } from '@/lib/editor/layer-tree.ts'
import { renameFrame } from '@/lib/editor/rename-frame.ts'
import { swatchOf } from '@/lib/editor/swatch.ts'
import { useLocale, useMessages } from '@/lib/i18n/client.tsx'
import { dirOf, format } from '@/lib/i18n/index.ts'

import { FrameStepper } from './frame-stepper.tsx'
import { pictured } from './layer-picture.tsx'
import { LayerRow } from './layer-row.tsx'
import { MaskArrows } from './mask-arrow.tsx'
import { keysOf, type RowApi, useRowPitch, useTouchScreen, type Where } from './tree-row.tsx'
import { useLayerPictures } from './use-layer-pictures.ts'
import { scrollToRow, useRowWindow } from './use-row-window.ts'
import { useShownFrame } from './use-shown-frame.ts'
import { useTreeFocus } from './use-tree-focus.ts'

const ARROWS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']

export function LayersPanel({ editor }: { editor: Editor }) {
  const t = useMessages()
  const rtl = dirOf(useLocale()) === 'rtl'
  // The rows show no layer's place or size, so a drag's moves leave them be.
  const { design, version } = useLiveDesign(editor, 'held places')
  const selection = useSelection(editor)
  const picked = usePickedFrame(editor)
  // The rows lit as chosen: the selected layers'.
  const selected = useMemo(() => new Set(selection), [selection])

  const pageId = useShownPage(editor)
  const page = design.pages[pageId]
  const frames = framesOf(design, pageId)
  const frameKey = frames.map(([id]) => id).join(' ')
  const frameIds = useMemo(() => (frameKey ? frameKey.split(' ') : []), [frameKey])
  // The title row's note names the page the frame is on, as in the mock.
  useFlyoutNote(page?.name ?? null)

  const { frameId, step: stepShown } = useShownFrame({ editor, design, pageId, frameIds, selection, picked })
  const frame = frameId === null ? undefined : design.frames[frameId]

  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  // A selection on the stage shows in the panel: each time the selection changes, the groups it is
  // in open, even those closed by hand since; until then they stay as they were left.
  const selectionKey = selection.join(' ')
  useEffect(() => {
    const opening = opensFor(design, selection)
    if (opening.length === 0) return
    setExpanded((now) => {
      const add = opening.filter((id) => !now.has(id))
      return add.length > 0 ? new Set([...now, ...add]) : now
    })
  }, [selectionKey])

  // The panel's own moves, counted so the rows show a move in the render that follows its key, not
  // a frame later at the redraw.
  const [moved, setMoved] = useState(0)
  // The version is how the live design says it changed.
  const { rows, arrows } = useMemo(
    () => treeRows(design, frameId, expanded),
    [design, version, moved, frameId, expanded],
  )
  const indexOf = useMemo(() => new Map(rows.map((row, i) => [row.id, i])), [rows])

  // Which rows are in view.
  const panel = useRef<HTMLDivElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const scrollerRef = useOverlayScroll(scroller)
  const pitch = useRowPitch()
  const touch = useTouchScreen()
  const { view, follow } = useRowWindow(scroller, pitch)
  const scrolledAt = useRef(0)
  const first = view.from
  const last = Math.min(rows.length, view.to)

  const [renaming, setRenaming] = useState<string | null>(null)
  // A tab that may only view selects, shows and opens rows, and renames, moves, hides and locks
  // none (C35); turning view-only ends a rename.
  const viewOnly = useViewOnly()
  useEffect(() => {
    if (viewOnly) setRenaming(null)
  }, [viewOnly])
  const [drop, setDrop] = useState<{ id: string; where: Where } | null>(null)
  const dragged = useRef<string | null>(null)
  const nameButton = useRef<HTMLButtonElement | null>(null)
  // A frame's rename ended from the keyboard: the focus goes back to its name once it shows again.
  const backToName = useRef(false)
  useLayoutEffect(() => {
    if (!backToName.current || renaming === frameId) return
    backToName.current = false
    nameButton.current?.focus()
  })
  const { active, current, reveal, focused } = useTreeFocus({
    editor,
    design,
    rows,
    indexOf,
    selected,
    scroller,
    follow,
    pitch,
  })

  // Another frame shown lists its layers from the top.
  const listedFor = useRef(frameId)
  useLayoutEffect(() => {
    if (listedFor.current === frameId) return
    listedFor.current = frameId
    const el = scroller.current
    if (!el) return
    el.scrollTop = 0
    follow(el)
  })
  // A selection made anywhere shows its row: the list scrolls to the topmost selected row once it
  // is listed, each time the selection changes.
  const shownFor = useRef('')
  useLayoutEffect(() => {
    const key = [...selected].join(' ')
    if (key === shownFor.current) return
    const at = Math.min(...[...selected].flatMap((id) => indexOf.get(id) ?? []))
    const el = scroller.current
    if (!Number.isFinite(at) && key) return
    shownFor.current = key
    if (!el || !Number.isFinite(at)) return
    scrollToRow(el, at, pitch)
    follow(el)
  })

  /** Picks the shown frame, panning at the same zoom to bring it out from under the panel. */
  const pickShown = () => {
    if (frameId === null) return
    editor.pickFrame(frameId)
    const flyout = panel.current?.closest('#editor-flyout')
    if (flyout) editor.showFrame(frameId, flyout.getBoundingClientRect())
  }
  // The layer row Shift and a click select the rows from: the one last selected alone, added or
  // taken out, by a click, Space or an arrow key (`rowClick`).
  const anchor = useRef<string | null>(null)
  /**
   * Selects a layer by its row as the keys it was clicked with say (`rowClick`): alone, added to the
   * selection or taken from it, or the rows from the anchor to it, or from `fallback` with no anchor.
   */
  const select = (id: string, keys: ClickKeys = { shift: false, mod: false }, fallback: string | null = null) => {
    const click = rowClick(rows, id, keys, selection, anchor.current, fallback)
    anchor.current = click.anchor
    if ('toggle' in click) editor.toggleSelected(click.toggle)
    else editor.select(click.select)
  }
  const toggle = (id: string, open = !expanded.has(id)) => {
    const next = new Set(expanded)
    if (open) next.add(id)
    else next.delete(id)
    setExpanded(next)
  }

  /** Moves a layer next to or into another, as the panel shows them. */
  const place = (id: string, target: Row, where: Where) => {
    if (id === target.id) return false
    if (where === 'into') {
      const moved = editor.moveLayer(id, target.id)
      if (moved) toggle(target.id, true)
      return moved
    }
    // Rows run topmost first; in the document the topmost is last. Above a row is after it there.
    const siblings = childrenOf(design, target.parentId)
      .map(([sibling]) => sibling)
      .filter((sibling) => sibling !== id)
    const at = siblings.indexOf(target.id)
    const before = where === 'below' ? target.id : siblings[at + 1]
    return editor.moveLayer(id, target.parentId, before)
  }

  /** Alt with the arrows: up and down among its siblings, into the group above it, or out of its group. */
  const shift = (row: Row, key: string) => {
    const siblings = childrenOf(design, row.parentId).map(([sibling]) => sibling)
    const at = siblings.indexOf(row.id)
    const inward = rtl ? 'ArrowLeft' : 'ArrowRight'
    if (key === 'ArrowUp') {
      const above = siblings[at + 1]
      return above !== undefined && editor.moveLayer(row.id, row.parentId, siblings[at + 2])
    }
    if (key === 'ArrowDown') {
      const below = siblings[at - 1]
      return below !== undefined && editor.moveLayer(row.id, row.parentId, below)
    }
    if (key === inward) {
      const above = siblings[at + 1]
      const holder = above && design.nodes[above]
      if (!above || !holder || !canHold(holder.type, row.node.type)) return false
      const moved = editor.moveLayer(row.id, above)
      if (moved) toggle(above, true)
      return moved
    }
    const parent = design.nodes[row.parentId]
    if (!parent) return false
    const outer = childrenOf(design, parent.parentId).map(([sibling]) => sibling)
    return editor.moveLayer(row.id, parent.parentId, outer[outer.indexOf(row.parentId) + 1])
  }

  /** A layer's place in the list as the document has it now, with the groups it is in open: where a move took it. */
  const placeOf = (id: string) => {
    const open = new Set(expanded)
    for (const up of ancestorsOf(design, design.nodes[id]?.parentId ?? '')) open.add(up)
    const at = treeRows(design, frameId, open).rows.findIndex((r) => r.id === id)
    return at < 0 ? undefined : at
  }

  const onKey = (event: KeyboardEvent<HTMLElement>, row: Row, i: number) => {
    if (renaming) return
    let handled = true
    if (event.altKey && ARROWS.includes(event.key)) {
      if (!viewOnly && shift(row, event.key)) {
        setMoved((n) => n + 1)
        reveal(row.id, placeOf(row.id))
      }
    } else if (ARROWS.includes(event.key) || event.key === 'Home' || event.key === 'End') {
      // Onto a layer's row selects the layer, and with Shift the rows from the anchor, or from the
      // row the focus leaves, to it. Up or Home from the first row, and outward from a top-level
      // layer, pick the frame at its name in the stepper.
      const step = arrowStep(rows, i, event.key, expanded, rtl)
      const outward = event.key === (rtl ? 'ArrowRight' : 'ArrowLeft')
      if (step && 'go' in step && !(i === 0 && event.key === 'Home')) {
        select(step.go.id, { shift: event.shiftKey, mod: false }, row.id)
        reveal(step.go.id)
      } else if (step && !('go' in step)) toggle(step.toggle, step.open)
      else if (i === 0 ? ['ArrowUp', 'Home'].includes(event.key) || outward : row.depth === 0 && outward) {
        pickShown()
        nameButton.current?.focus()
      }
    } else if ((event.key === 'Enter' || event.key === 'F2') && !viewOnly) setRenaming(row.id)
    else if (event.key === ' ') select(row.id, keysOf(event))
    else handled = false
    // The stage's own shortcuts, such as Delete or lock and hide, still act on the selection.
    if (handled) {
      event.preventDefault()
      event.stopPropagation()
    }
  }

  /** Where a layer dragged over a row would go, or null; a layer moves only within its own frame. */
  const whereOn = (event: DragEvent<HTMLElement>, row: Row): Where | null => {
    const id = dragged.current
    const node = id && design.nodes[id]
    if (!node || id === row.id || frameIdOf(design, id) !== row.frameId) return null
    const box = event.currentTarget.getBoundingClientRect()
    const y = (event.clientY - box.top) / box.height
    if (canHold(row.node.type, node.type) && y > 0.25 && y < 0.75) return 'into'
    return y < 0.5 ? 'above' : 'below'
  }
  /** Whether the layer dragged would go to the shown frame's top, dropped on the stepper. */
  const toFrameTop = () => {
    const id = dragged.current
    return !viewOnly && id !== null && frameId !== null && frameIdOf(design, id) === frameId
  }

  // The rows get one object whose calls reach the latest handlers, so a row that hasn't changed
  // isn't rendered again when the view scrolls or another row changes.
  const latest = useRef<RowApi | null>(null)
  latest.current = {
    focus: focused,
    key: onKey,
    click: (id, keys) => select(id, keys),
    rename: (id) => {
      if (!viewOnly) setRenaming(id)
    },
    renamed: (id, name, before, byKey) => {
      setRenaming(null)
      const next = name?.trim()
      if (!viewOnly && next && next !== before) editor.renameLayer(id, next)
      // Ended from the keyboard, the focus goes back to the row; ended by a click elsewhere, it
      // stays where the click put it.
      if (byKey) reveal(id)
    },
    toggle: (id) => toggle(id),
    lock: (id, locked) => {
      if (!viewOnly) editor.setLocked([id], locked)
    },
    hide: (id, hidden) => {
      if (!viewOnly) editor.setHidden([id], hidden)
    },
    dragStart: (id) => {
      dragged.current = viewOnly ? null : id
    },
    dragEnd: () => {
      dragged.current = null
      setDrop(null)
    },
    dragOver: (event, row) => {
      if (viewOnly) return false
      const where = whereOn(event, row)
      if (!where) return false
      if (drop?.id !== row.id || drop.where !== where) setDrop({ id: row.id, where })
      return true
    },
    dragLeave: (id) => {
      if (drop?.id === id) setDrop(null)
    },
    drop: (event, row) => {
      const where = whereOn(event, row)
      const from = dragged.current
      setDrop(null)
      if (!where || !from || viewOnly) return false
      place(from, row, where)
      return true
    },
    hover: (row) => editor.lightLayer(row ? { id: row.id, frameId: row.frameId } : null),
  }
  const api = useMemo<RowApi>(() => {
    const call = <K extends keyof RowApi>(name: K) =>
      ((...args: unknown[]) => (latest.current?.[name] as (...a: unknown[]) => unknown)(...args)) as RowApi[K]
    return {
      focus: call('focus'),
      key: call('key'),
      click: call('click'),
      rename: call('rename'),
      renamed: call('renamed'),
      toggle: call('toggle'),
      lock: call('lock'),
      hide: call('hide'),
      dragStart: call('dragStart'),
      dragEnd: call('dragEnd'),
      dragOver: call('dragOver'),
      dragLeave: call('dragLeave'),
      drop: call('drop'),
      hover: call('hover'),
    }
  }, [])
  // The stage lets go of the row's layer when the panel closes under the pointer.
  useEffect(() => () => editor.lightLayer(null), [editor])

  // The rows in view, with the row Tab lands on and the row the focus was last on wherever they are,
  // so the focus stays in the tree when its row scrolls away and Tab always reaches the tree.
  const places = new Set<number>()
  for (let i = first; i < last; i++) places.add(i)
  for (const id of [current, active]) {
    const at = id === null ? undefined : indexOf.get(id)
    if (at !== undefined) places.add(at)
  }
  const shown = [...places].sort((a, b) => a - b).flatMap((i) => (rows[i] ? [{ row: rows[i], i }] : []))
  const pictures = useLayerPictures(
    editor,
    pageId,
    shown.flatMap(({ row }) => (pictured(row.node) ? [row.id] : [])),
    scrolledAt,
  )
  return (
    // On a phone the panel is no taller than the mock's, so the frames stay in view above it.
    <div
      ref={panel}
      className="flex min-h-0 flex-1 flex-col max-sm:max-h-[calc(56dvh-3.5rem-2px)]"
      data-testid="layers"
    >
      {frameId === null || !frame ? (
        <p className="p-4 text-small text-muted">{t.editor.frames.noFrames}</p>
      ) : (
        <>
          <FrameStepper
            frameId={frameId}
            frame={frame}
            steps={canStep(frameIds)}
            picked={picked === frameId}
            renaming={renaming === frameId}
            dropInto={drop?.id === frameId}
            swatch={swatchOf(frame.fills)}
            pitch={pitch}
            onStep={stepShown}
            onPick={pickShown}
            onRename={() => {
              if (!viewOnly) setRenaming(frameId)
            }}
            onRenamed={(name, byKey) => {
              setRenaming(null)
              if (!viewOnly) renameFrame(editor, frameId, name)
              backToName.current = byKey
            }}
            onNameKey={(event) => {
              const does = nameKey(event.key, viewOnly)
              if (does === null) return
              if (does === 'rename') setRenaming(frameId)
              else if (does === 'into tree' && rows[0]) {
                select(rows[0].id)
                reveal(rows[0].id, 0, true)
              }
              event.preventDefault()
              event.stopPropagation()
            }}
            onDragOver={(event) => {
              if (!toFrameTop()) return
              event.preventDefault()
              event.dataTransfer.dropEffect = 'move'
              if (drop?.id !== frameId) setDrop({ id: frameId, where: 'into' })
            }}
            onDragLeave={() => {
              if (drop?.id === frameId) setDrop(null)
            }}
            onDrop={(event) => {
              const from = dragged.current
              setDrop(null)
              if (!from || !toFrameTop()) return
              event.preventDefault()
              editor.moveLayer(from, frameId)
            }}
            nameRef={(el) => {
              nameButton.current = el
            }}
          />
          <div
            ref={scrollerRef}
            onScroll={(event) => {
              scrolledAt.current = performance.now()
              follow(event.currentTarget)
            }}
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1.5 pt-1 pb-2"
            data-testid="layers-scroller"
          >
            <div
              role="tree"
              aria-label={format(t.editor.layersPanel.tree, { frame: frame.name })}
              aria-multiselectable
              className="relative"
              style={{ height: rows.length * pitch }}
            >
              <MaskArrows arrows={arrows} rows={rows} pitch={pitch} />
              {shown.map(({ row, i }) => (
                <LayerRow
                  key={row.id}
                  row={row}
                  i={i}
                  selected={selected.has(row.id)}
                  focusable={row.id === current}
                  renaming={renaming === row.id}
                  open={expanded.has(row.id)}
                  hidden={row.node.props.visible === false}
                  drop={drop?.id === row.id ? drop.where : null}
                  picture={pictures[row.id] ?? null}
                  pitch={pitch}
                  touch={touch}
                  api={api}
                />
              ))}
            </div>
            {rows.length === 0 && (
              <EmptyState
                pose="layers"
                tight
                title={t.editor.layersPanel.empty.title}
                // A tab that may only view is told nothing it can't do.
                {...(viewOnly ? {} : { line: t.editor.layersPanel.empty.line })}
              />
            )}
          </div>
        </>
      )}
    </div>
  )
}
