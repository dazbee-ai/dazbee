'use client'

// The design's pages. Pages, by the zoom pill or on a phone in the tab bar, says which page the
// canvas shows and how many there are ("Pages 2/3", "2/3" in the tab bar) and opens the Pages panel:
// each page's picture, name and number of frames, shown with a click and reordered by dragging; ⋯
// renames, duplicates, moves and deletes one, and Add page adds one holding a frame the size of the
// frame you are on. Under the shown page come its sections, top to bottom, each zooming to fit it.
// Every change is a command, so it is one undo step and reaches the other tabs.
import { type CSSProperties, Fragment, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'

import type { Editor } from '@dazbee/editor'
import { type Design, framesInSection, framesOf, inOrder, sectionsByPlace } from '@dazbee/schema'

import { PanelFrame } from '@/components/editor/edit-panel/edit-panel.tsx'
import { useViewOnly } from '@/components/editor/view-only.tsx'
import { FilesIcon, PlusIcon } from '@/components/ui/icons.tsx'
import { FOCUS_RING } from '@/components/ui/looks.ts'
import { RenameField, useFocusBack } from '@/components/ui/rename-field.tsx'
import { cn } from '@/lib/cn.ts'
import { sizeYouAreOn } from '@/lib/editor/size.ts'
import { frameName } from '@/lib/frame-name.ts'
import { useLocale, useMessages } from '@/lib/i18n/client.tsx'
import { counted, format, type Messages } from '@/lib/i18n/index.ts'

import { afterDraws, sameUrls } from './after-draws.ts'
import { CARD_ROW, CardMenu } from './card.tsx'
import { setOpen, useEditState } from './edit-store.ts'
import { useEditorDesign, useShownPage } from './editor-hooks.ts'
import { DROP_LINE, PANEL_BUTTON, RENAME_IN_ROW, TAB_BAR_CHIP } from './styles.ts'

/** The frame a new page starts with: the size of the frame you are on (`sizeYouAreOn`), named after its size. */
function newPageFrame(editor: Editor, design: Design, t: Messages) {
  const on = sizeYouAreOn(editor, design)
  return { name: frameName(t, on.width, on.height), width: on.width, height: on.height }
}

/** Each page's picture of its first frame, drawn once the stage settles and again once its fonts and images arrive. */
function usePagePictures(editor: Editor): Record<string, string | null> {
  const [pictures, setPictures] = useState<Record<string, string | null>>({})
  useEffect(
    () =>
      afterDraws(editor, () => {
        const next = Object.fromEntries(
          Object.keys(editor.session.design().pages).map((id) => [id, editor.pageThumbnail(id, 72)]),
        )
        setPictures((now) => (sameUrls(now, next) ? now : next))
      }),
    [editor],
  )
  return pictures
}

/**
 * Pages by the zoom pill: before it on desktop, over it on a tablet, where the tool dock leaves no
 * room beside it; on a phone a chip of the tab bar (`inBar`), before the zoom.
 */
export function PagesButton({ editor, inBar = false }: { editor: Editor | null; inBar?: boolean }) {
  const t = useMessages()
  if (!editor)
    return (
      <PagesFrame label={t.editor.pages.title} inBar={inBar} disabled>
        <span>{t.editor.pages.title}</span>
      </PagesFrame>
    )
  return <LivePages editor={editor} inBar={inBar} />
}

export function PagesPanel({ editor, onRemoved }: { editor: Editor; onRemoved: (message: string) => void }) {
  const t = useMessages()
  const { open } = useEditState()
  if (open !== 'pages') return null
  return (
    <PanelFrame id="pages" title={t.editor.pages.title}>
      <PageList editor={editor} onRemoved={onRemoved} />
    </PanelFrame>
  )
}

function PagesFrame({
  label,
  inBar,
  disabled = false,
  children,
}: {
  label: string
  inBar: boolean
  disabled?: boolean
  children: ReactNode
}) {
  const { open } = useEditState()
  const button = useRef<HTMLButtonElement>(null)
  // Where the zoom pill ends, so Pages sits just beside or above it.
  const [zoom, setZoom] = useState({ width: 0, height: 0 })
  useLayoutEffect(() => {
    const pill = inBar ? null : button.current?.parentElement?.querySelector<HTMLElement>('[data-zoom]')
    if (!pill) return
    const measure = () => setZoom({ width: pill.offsetWidth, height: pill.offsetHeight })
    measure()
    const watch = new ResizeObserver(measure)
    watch.observe(pill)
    return () => watch.disconnect()
  }, [inBar])
  // As tall as the zoom pill beside it.
  const place = {
    '--zoom-width': `${zoom.width}px`,
    '--zoom-height': `${zoom.height}px`,
    ...(zoom.height > 0 ? { height: zoom.height } : {}),
  } as CSSProperties
  return (
    <button
      ref={button}
      type="button"
      data-pages={inBar ? undefined : ''}
      data-opens="pages"
      data-testid="pages-button"
      disabled={disabled}
      aria-label={label}
      title={label}
      aria-expanded={open === 'pages'}
      onClick={() => setOpen(open === 'pages' ? null : 'pages')}
      style={inBar ? undefined : place}
      className={cn(
        'group',
        inBar
          ? TAB_BAR_CHIP
          : cn(
              // Open, it keeps its glass under the pressed tint, its icon pink and its words in the text colour.
              'absolute z-10 flex h-9 cursor-pointer items-center gap-1.5 rounded-card surface-frost px-3 text-label font-semibold text-text transition-colors hover:text-accent-text disabled:cursor-default disabled:opacity-40 aria-expanded:tint-pressed aria-expanded:text-text',
              // Beside the zoom pill; on a narrow desktop stacked over it, clear of the dock; on a
              // tablet beside it again, the two above the dock.
              'end-[calc(1.5rem+var(--zoom-width))] bottom-4 max-xl:end-4 max-xl:bottom-[calc(1.5rem+var(--zoom-height))] max-lg:end-[calc(1.5rem+var(--zoom-width))] max-lg:bottom-(--above-dock)',
              FOCUS_RING,
            ),
      )}
    >
      {/* In the tab bar of the narrowest phones, the count alone, so the bar fits. */}
      <FilesIcon
        size={15}
        aria-hidden
        className={cn('shrink-0 group-aria-expanded:text-accent-text', inBar && 'max-[380px]:hidden')}
      />
      {children}
    </button>
  )
}

/** Pages once the design is open: which page the canvas shows, of how many. */
function LivePages({ editor, inBar }: { editor: Editor; inBar: boolean }) {
  const t = useMessages()
  const { design } = useEditorDesign(editor)
  const current = useShownPage(editor)
  const pages = inOrder(design.pages)
  const counts = { n: Math.max(1, pages.findIndex(([id]) => id === current) + 1), total: pages.length }
  return (
    <PagesFrame label={format(t.editor.pages.buttonLabel, counts)} inBar={inBar}>
      <span aria-hidden className="tabular-nums">
        {format(inBar ? t.editor.pages.count : t.editor.pages.button, counts)}
      </span>
    </PagesFrame>
  )
}

/** Each page: its picture, name and number of frames, shown with a click, renamed with a double click, dragged to reorder; then Add page. */
function PageList({ editor, onRemoved }: { editor: Editor; onRemoved: (message: string) => void }) {
  const t = useMessages()
  const g = t.editor.pages
  const { design } = useEditorDesign(editor)
  const pages = inOrder(design.pages)
  const current = useShownPage(editor)
  const [renaming, setRenaming] = useState<string | null>(null)
  const focusBack = useFocusBack()
  // The page being dragged, and the page it would land before (null for the end).
  const [dragging, setDragging] = useState<string | null>(null)
  const [landing, setLanding] = useState<{ before: string | null } | null>(null)
  const run = editor.session.run.bind(editor.session)
  const pictures = usePagePictures(editor)
  // A tab that may only view shows pages and changes none: no rename, drag, ⋯ or Add page (C35).
  const viewOnly = useViewOnly()
  const editing = renaming !== null && !viewOnly ? renaming : null

  // The canvas shows the page with its frames fitted, letting go of what was selected or picked;
  // a page a Reviewer's tab could not add shows nothing (C35).
  const show = (id: string | undefined) => {
    if (id !== undefined) editor.showPage(id)
  }
  const rename = (id: string, name: string | null, byKey: boolean) => {
    if (byKey) focusBack.mark(id)
    setRenaming(null)
    const trimmed = name?.trim()
    if (trimmed && trimmed !== design.pages[id]?.name) run('page.update', { id, name: trimmed })
  }
  // Landing just before or after the dragged page leaves the order as it is.
  const from = pages.findIndex(([p]) => p === dragging)
  const to = landing?.before === null ? pages.length : pages.findIndex(([p]) => p === landing?.before)
  const moves = dragging !== null && landing !== null && to !== from && to !== from + 1
  const drop = () => {
    if (moves) run('page.move', { id: dragging, before: landing.before })
    setDragging(null)
    setLanding(null)
  }
  const add = () => {
    // "Page N" after the last, skipping a name a page already has.
    const names = new Set(pages.map(([, p]) => p.name))
    let n = pages.length + 1
    while (names.has(format(g.newName, { n }))) n++
    show(run('page.add', { name: format(g.newName, { n }), frame: newPageFrame(editor, design, t) }))
  }

  return (
    <>
      <ol aria-label={g.title} className="flex flex-col gap-1.5" data-testid="pages">
        {pages.map(([id, page], i) => {
          const frames = framesOf(design, id)
          const first = frames[0]?.[1]
          // The picture of its first frame, its long side 34, on that frame's background until one is drawn.
          const tile = first
            ? {
                width: Math.max(8, Math.round(34 * Math.min(1, first.width / first.height))),
                height: Math.max(8, Math.round(34 * Math.min(1, first.height / first.width))),
              }
            : { width: 34, height: 34 }
          const fill = first?.fills[0]
          const picture = pictures[id]
          return (
            <Fragment key={id}>
              <li
                data-page={id}
                aria-current={current === id ? 'page' : undefined}
                data-dragging={dragging === id ? '' : undefined}
                draggable={!viewOnly && editing !== id}
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = 'move'
                  e.dataTransfer.setData('application/x-dazbee-page', id)
                  setDragging(id)
                }}
                onDragOver={(e) => {
                  if (!dragging) return
                  e.preventDefault()
                  const box = e.currentTarget.getBoundingClientRect()
                  const before = e.clientY < box.top + box.height / 2 ? id : (pages[i + 1]?.[0] ?? null)
                  if (landing?.before !== before) setLanding({ before })
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  if (!viewOnly) drop()
                }}
                onDragEnd={() => {
                  setDragging(null)
                  setLanding(null)
                }}
                className={cn(
                  CARD_ROW,
                  // Lit by the tints laid over its fill under the pointer and while pressed.
                  !viewOnly && 'cursor-grab active:cursor-grabbing',
                  'relative hover:tint-hover hover:lit active:tint-pressed active:lit aria-[current]:border-accent aria-[current]:bg-accent-soft aria-[current]:lit data-[dragging]:opacity-40',
                )}
              >
                {moves && landing?.before === id && <span aria-hidden className={cn(DROP_LINE, '-top-[4px]')} />}
                {moves && landing?.before === null && i === pages.length - 1 && (
                  <span aria-hidden className={cn(DROP_LINE, '-bottom-[4px]')} />
                )}
                <span aria-hidden className="relative grid size-[34px] shrink-0 place-items-center">
                  {/* The first frame's picture on white, as the canvas draws it, under the frame's colour while
                    the picture is drawn; a page with no frames shows an empty well. */}
                  <span
                    data-testid="page-thumbnail"
                    className={cn(
                      'relative grid place-items-center overflow-hidden rounded-[3px] border border-line-strong',
                      first ? 'bg-white' : 'bg-well',
                    )}
                    style={{ ...tile, backgroundColor: fill?.type === 'solid' ? fill.color : undefined }}
                  >
                    {picture && <img src={picture} alt="" draggable={false} className="absolute inset-0 size-full" />}
                  </span>
                  {/* The page's number on a dark chip, readable over any picture or page colour and whole over a
                    thin tile. */}
                  <span
                    data-testid="page-number"
                    className="absolute inset-0 m-auto size-fit rounded-[4px] bg-black/60 px-1 font-mono text-micro leading-[14px] font-semibold text-white tabular-nums"
                  >
                    {i + 1}
                  </span>
                </span>
                {editing === id ? (
                  <RenameField
                    name={page.name}
                    label={g.rename}
                    inputName="page-name"
                    className={RENAME_IN_ROW}
                    onDone={(name, byKey) => rename(id, name, byKey)}
                  />
                ) : (
                  <button
                    ref={focusBack.ref(id)}
                    type="button"
                    onClick={() => show(id)}
                    onDoubleClick={() => !viewOnly && setRenaming(id)}
                    onKeyDown={(e) => !viewOnly && e.key === 'F2' && setRenaming(id)}
                    aria-label={format(g.show, { name: page.name })}
                    className={cn(
                      'flex min-w-0 flex-1 cursor-pointer flex-col items-start rounded-[6px] text-start',
                      FOCUS_RING,
                    )}
                  >
                    <span className="w-full truncate text-small font-semibold text-text">
                      {format(g.numbered, { n: i + 1, name: page.name })}
                    </span>
                    <span className="w-full truncate text-caption text-subtle">
                      {format(frames.length === 0 ? g.framesNone : frames.length === 1 ? g.framesOne : g.framesMany, {
                        n: frames.length,
                      })}
                    </span>
                  </button>
                )}
                {!viewOnly && (
                  <CardMenu
                    label={format(g.more, { name: page.name })}
                    items={[
                      { label: g.rename, run: () => setRenaming(id) },
                      {
                        label: g.duplicate,
                        run: () => show(run('page.duplicate', { id, name: format(g.copyName, { name: page.name }) })),
                      },
                      {
                        label: g.moveUp,
                        why: i === 0 ? g.firstAlready : null,
                        run: () => run('page.move', { id, before: pages[i - 1]?.[0] ?? null }),
                      },
                      {
                        label: g.moveDown,
                        why: i === pages.length - 1 ? g.lastAlready : null,
                        run: () => run('page.move', { id, before: pages[i + 2]?.[0] ?? null }),
                      },
                      {
                        label: g.remove,
                        why: pages.length === 1 ? g.onlyPage : null,
                        danger: true,
                        run: () => {
                          run('page.delete', { id })
                          onRemoved(format(g.removed, { name: page.name }))
                        },
                      },
                    ]}
                  />
                )}
              </li>
              {current === id && <SectionList editor={editor} design={design} pageId={id} />}
            </Fragment>
          )
        })}
      </ol>
      {!viewOnly && (
        <button type="button" onClick={add} data-testid="add-page" className={cn(PANEL_BUTTON, 'justify-center')}>
          <PlusIcon size={14} aria-hidden className="shrink-0" />
          <span>{g.add}</span>
        </button>
      )}
    </>
  )
}

/**
 * The shown page's sections, top to bottom (`sectionsByPlace`), each with its title and number of
 * frames; a click zooms to fit it. None while the page has none.
 */
function SectionList({ editor, design, pageId }: { editor: Editor; design: Design; pageId: string }) {
  const s = useMessages().editor.sections
  const locale = useLocale()
  const sections = sectionsByPlace(design, pageId)
  if (sections.length === 0) return null
  return (
    <li data-testid="page-sections" className="ps-6">
      <ul aria-label={s.list} className="flex flex-col gap-0.5">
        {sections.map(([id, section]) => (
          <li key={id} data-section={id}>
            <button
              type="button"
              onClick={() => editor.fitSection(id)}
              aria-label={format(s.show, { name: section.title })}
              className={cn(
                'flex w-full min-w-0 cursor-pointer items-baseline gap-2 rounded-[6px] px-2 py-1 text-start hover:bg-hover active:bg-pressed',
                FOCUS_RING,
              )}
            >
              <span className="min-w-0 flex-1 truncate text-small text-text">{section.title}</span>
              <span className="shrink-0 text-caption text-subtle">
                {counted(locale, s.frameCount, framesInSection(design, id).length)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </li>
  )
}
