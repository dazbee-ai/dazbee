'use client'

// The font of the selected text: a family from the brand's uploads, the Google Fonts we copied
// into our storage, or the fonts we ship, and its weight. A search, a category's chip and a script
// narrow the families, listed as the brand's, the ones used last, then all, most used first, with
// the chosen family's weights under it; only the rows in view are drawn, each with its preview. A
// brand can upload a TrueType or OpenType file from the same list.
import { type KeyboardEvent, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'

import type { Editor } from '@dazbee/editor'
import { type Design, FontFace, FontFamily } from '@dazbee/schema'

import type { FontCategory } from '@/components/brand-kit/font-catalog.ts'
import { useEditorDesign, useSelection } from '@/components/editor/editor-hooks.ts'
import { CHIP, PANEL_BUTTON, PANEL_HEADING } from '@/components/editor/styles.ts'
import { useViewOnly } from '@/components/editor/view-only.tsx'
import { NoMatch } from '@/components/ui/empty-state.tsx'
import { MagnifyingGlassIcon, UploadSimpleIcon } from '@/components/ui/icons.tsx'
import { useOverlayScroll } from '@/components/ui/overlay-scroll.ts'
import { offersChoice, Select } from '@/components/ui/select.tsx'
import { brandPath, readJson } from '@/lib/brand-routes.ts'
import { cn } from '@/lib/cn.ts'
import { useLocale, useMessages } from '@/lib/i18n/client.tsx'
import { format } from '@/lib/i18n/index.ts'

import { ChooserRow } from './chooser-row.tsx'
import { drawnRows, keptInPlace, layOut, scrollToShow, scrollToShowWeights } from './drawn-rows.ts'
import {
  type ChosenFont,
  filterChoices,
  fontPick,
  type FontRow,
  fontRows,
  scriptNames,
  stepActive,
} from './font-rows.ts'
import { recentFonts } from './recent-fonts.ts'

/** How tall the list shows at most, in pixels (`max-h-[min(20rem,…)]`), as the rows drawn before it is measured. */
const LIST_HEIGHT = 320

/** The families used last in each brand, in this device's storage. */
const RECENT = recentFonts(() => window.localStorage)

/** The one value every entry has, or null. */
const same = <T,>(values: T[]) => (values.every((v) => v === values[0]) ? (values[0] ?? null) : null)

/** The base style of the selected text layers: their family and weight, each null where they differ. */
function selectedFont(design: Design, ids: string[]): ChosenFont | null {
  const styles = ids.flatMap((id) => {
    const node = design.nodes[id]
    return node?.type === 'text' ? [node.props.style] : []
  })
  if (styles.length === 0) return null
  return {
    family: same(styles.map((style) => style.fontFamily)),
    weight: same(styles.map((style) => style.fontWeight)),
  }
}

/**
 * The brand's families used last, as they were when the chooser opened, and how to note one used:
 * the list keeps its order while the chooser is open, so trying fonts doesn't move the rows.
 */
function useRecentFonts(brandId: string) {
  const [shown] = useState(() => RECENT.list(brandId))
  const record = useCallback((family: string) => RECENT.record(brandId, family), [brandId])
  return { shown, record }
}

/**
 * The font of the selected text, in the edit panel's place: a search, the category chips, then the
 * families in their groups to pick from, the chosen family's weights under it, and an upload. The
 * catalog is fetched again each time it opens, so a brand's new upload shows. A pick or an upload
 * sets the font and leaves the chooser open, to try another or set the weight.
 */
export function FontChooser({
  editor,
  workspaceId,
  brandId,
  catalog,
  refresh,
  onDone,
}: {
  editor: Editor
  workspaceId: string
  brandId: string
  catalog: FontFamily[]
  refresh: () => Promise<void>
  onDone: () => void
}) {
  const { design } = useEditorDesign(editor)
  const selected = useSelection(editor)
  const recent = useRecentFonts(brandId)
  // Whether the catalog has been fetched since the chooser opened, so it can open on the text's family.
  const [fetched, setFetched] = useState(false)
  useEffect(() => {
    void refresh().finally(() => setFetched(true))
  }, [refresh])
  // With a range of the text being edited selected, its font is the range's.
  const range = editor.textSelectionStyles()
  const current = range
    ? { family: same(range.map((s) => s.fontFamily)), weight: same(range.map((s) => s.fontWeight)) }
    : selectedFont(design, selected)
  if (!current) return null
  const pick = (row: FontRow) => {
    if (row.kind === 'weight') {
      editor.setFont(row.family.family, row.weight)
      return
    }
    if (row.kind !== 'family') return
    const font = fontPick(row.family, current.weight)
    editor.setFont(font.family, font.weight)
    recent.record(font.family)
  }
  return (
    <div className="flex min-h-0 min-w-0 flex-col gap-2" data-testid="font-chooser">
      <FontList
        workspaceId={workspaceId}
        brandId={brandId}
        catalog={catalog}
        fetched={fetched}
        recent={recent.shown}
        current={current}
        onPick={pick}
        onClose={onDone}
        onUploaded={async (face) => {
          await refresh()
          editor.setFont(face.family, face.weight)
        }}
      />
    </div>
  )
}

function FontList({
  workspaceId,
  brandId,
  catalog,
  fetched,
  recent,
  current,
  onPick,
  onClose,
  onUploaded,
}: {
  workspaceId: string
  brandId: string
  catalog: FontFamily[]
  /** Whether the catalog has been fetched since the chooser opened. */
  fetched: boolean
  recent: readonly string[]
  current: ChosenFont
  onPick: (row: FontRow) => void
  onClose: () => void
  onUploaded: (face: FontFace) => Promise<void>
}) {
  const t = useMessages()
  const id = useId()
  // A tab that may only view shows the fonts and picks none (C35); the fieldset round it turns off
  // the search, the chips and the upload, but not the families, which are options rather than controls.
  const viewOnly = useViewOnly()
  const locale = useLocale()
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<FontCategory | null>(null)
  const [script, setScript] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const list = useRef<HTMLDivElement>(null)
  const listRef = useOverlayScroll(list)

  const rows = useMemo(
    () => fontRows(catalog, { query, category, script }, recent, { family: current.family, weight: current.weight }),
    [catalog, query, category, script, recent, current.family, current.weight],
  )
  const choices = useMemo(() => filterChoices(catalog, { category, script }), [catalog, category, script])
  const scriptOptions = useMemo(() => {
    const name = scriptNames(locale)
    return [
      { value: '', label: t.editor.fonts.scripts.any },
      ...choices.scripts.map((code) => ({ value: code, label: name(code) })),
    ]
  }, [choices.scripts, locale, t])
  const layout = useMemo(() => layOut(rows), [rows])
  // The row the arrow keys move from and Enter picks; the first family when it is no longer listed.
  const [activeKey, setActive] = useState<string | null>(null)
  const active = rows.some((row) => row.key === activeKey) ? activeKey : stepActive(rows, null, 1)
  const [view, setView] = useState(() => drawnRows(rows, layout, 0, LIST_HEIGHT))
  const follow = useCallback(() => {
    const el = list.current
    if (!el) return
    const next = drawnRows(rows, layout, el.scrollTop, el.clientHeight)
    setView((now) => (now.from === next.from && now.to === next.to && now.pinned === next.pinned ? now : next))
  }, [rows, layout])
  useLayoutEffect(() => {
    const el = list.current
    if (!el) return
    follow()
    const observer = new ResizeObserver(follow)
    observer.observe(el)
    return () => observer.disconnect()
  }, [follow])
  // Once the catalog is fetched, the chooser shows the text's family at the top of the list, unless
  // a pick, a search, a chip or a key came first; later ones leave the list where it is.
  const opening = useRef(true)
  useLayoutEffect(() => {
    if (!fetched || !opening.current || !list.current) return
    opening.current = false
    const at = rows.findIndex((row) => row.kind === 'family' && row.family.family === current.family)
    const row = rows[at]
    if (!row) return
    setActive(row.key)
    list.current.scrollTop = layout.tops[at] ?? 0
  }, [fetched, rows, layout, current.family])

  // The row just picked and how far below the list's top edge it showed: it stays there as the rows
  // change round it, so the weights of the family picked before closing above it don't move it, and
  // the list scrolls only as far as its own weights need to show.
  const anchor = useRef<{ key: string; offset: number } | null>(null)
  useLayoutEffect(() => {
    const el = list.current
    const at = anchor.current
    if (!el || !at) return
    anchor.current = null
    const scrollTop = keptInPlace(rows, layout, at.key, at.offset)
    if (scrollTop !== null)
      el.scrollTop = scrollToShowWeights(rows, layout, at.key, scrollTop, el.clientHeight) ?? scrollTop
  }, [rows, layout])

  const pick = (row: FontRow) => {
    opening.current = false
    if (viewOnly) return
    const at = rows.indexOf(row)
    anchor.current = list.current ? { key: row.key, offset: (layout.tops[at] ?? 0) - list.current.scrollTop } : null
    onPick(row)
  }

  /** A new search, chip or script lists from the top. */
  const narrow = (next: { query?: string; category?: FontCategory | null; script?: string | null }) => {
    if (next.query !== undefined) setQuery(next.query)
    if (next.category !== undefined) setCategory(next.category)
    if (next.script !== undefined) setScript(next.script)
    opening.current = false
    anchor.current = null
    setActive(null)
    if (list.current) list.current.scrollTop = 0
  }

  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      opening.current = false
      anchor.current = null
      const next = stepActive(rows, active, event.key === 'ArrowDown' ? 1 : -1)
      setActive(next)
      const at = rows.findIndex((row) => row.key === next)
      const el = list.current
      if (el && at !== -1) el.scrollTop = scrollToShow(rows, layout, at, el.scrollTop, el.clientHeight)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const row = rows.find((one) => one.key === active)
      if (row) pick(row)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
    }
  }

  const upload = async (file: File) => {
    setUploading(true)
    setError(null)
    try {
      const form = new FormData()
      form.set('file', file)
      const response = await fetch(brandPath(workspaceId, brandId, 'fonts'), { method: 'POST', body: form })
      await onUploaded(FontFace.parse(await readJson(response)))
    } catch (reason) {
      setError(
        format(t.editor.fonts.uploadFailed, { reason: reason instanceof Error ? reason.message : String(reason) }),
      )
    } finally {
      setUploading(false)
    }
  }

  const heading = { brand: t.editor.fonts.brand, recent: t.editor.fonts.recent, all: t.editor.fonts.all }
  const activeAt = rows.findIndex((row) => row.key === active)
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3" data-testid="font-list">
      <div className="flex h-[34px] items-center gap-2 rounded-row border border-field-line bg-field px-2.5 focus-within:border-accent">
        <MagnifyingGlassIcon size={14} aria-hidden className="shrink-0 text-subtle" />
        <input
          name="font-search"
          // The list opens to be searched.
          autoFocus
          type="search"
          role="combobox"
          aria-expanded
          aria-controls={id}
          aria-activedescendant={activeAt === -1 ? undefined : `${id}-${activeAt}`}
          aria-label={t.editor.fonts.search}
          placeholder={t.editor.fonts.search}
          value={query}
          onChange={(event) => narrow({ query: event.target.value })}
          onKeyDown={onKey}
          data-testid="font-search"
          // The box round it shows the focus, its edge the accent, so the field draws no ring of its own.
          className="h-full min-w-0 flex-1 bg-transparent text-small outline-none placeholder:text-subtle focus-visible:outline-none!"
        />
      </div>
      {/* The chips and the script share a row, so the list keeps its room where the panel is short. */}
      <div className="flex flex-wrap items-center gap-1.5">
        <div role="group" aria-label={t.editor.fonts.categories.label} className="contents">
          {choices.categories.map((one) => (
            <button
              key={one}
              type="button"
              aria-pressed={category === one}
              data-testid={`font-category-${one}`}
              // A click leaves the focus in the search, where the arrow keys move through the list.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => narrow({ category: category === one ? null : one })}
              className={cn(
                CHIP,
                'px-2.5 aria-pressed:border-transparent aria-pressed:bg-accent-soft aria-pressed:text-text',
              )}
            >
              {t.editor.fonts.categories[one]}
            </button>
          ))}
        </div>
        {offersChoice(scriptOptions) && (
          <Select
            name="font-script"
            label={t.editor.fonts.scripts.label}
            value={script ?? ''}
            options={scriptOptions}
            onChange={(code) => narrow({ script: code === '' ? null : code })}
            className="h-7 max-w-full px-2.5 text-tiny font-semibold"
            testId="font-script"
          />
        )}
      </div>
      {/* The list alone scrolls, and gives way first where the panel is short, so the upload below stays in reach. */}
      <div className="flex min-h-0 flex-col">
        {/* The heading of the group scrolled to, which the next group's pushes out as it reaches the top. */}
        {view.pinned && (
          <div
            aria-hidden
            className={cn(PANEL_HEADING, 'flex h-7 shrink-0 items-center px-1')}
            data-testid="font-pinned"
          >
            {heading[view.pinned]}
          </div>
        )}
        <div
          ref={listRef}
          id={id}
          role="listbox"
          aria-label={t.editor.fonts.title}
          onScroll={follow}
          className="-mx-1 max-h-[min(20rem,40vh)] min-h-0 overflow-y-auto overscroll-contain"
        >
          {rows.length === 0 && <NoMatch query={query.trim()} />}
          <div className="relative" style={{ height: layout.total }}>
            {rows.slice(view.from, view.to).map((row, k) => {
              const i = view.from + k
              // The first heading shows pinned above the list.
              if (i === 0 && row.kind === 'heading') return null
              return (
                <ChooserRow
                  key={row.key}
                  id={`${id}-${i}`}
                  row={row}
                  top={layout.tops[i] ?? 0}
                  heading={heading[row.group]}
                  workspaceId={workspaceId}
                  brandId={brandId}
                  current={current}
                  active={row.key === active}
                  viewOnly={viewOnly}
                  onHover={() => setActive(row.key)}
                  onPick={() => pick(row)}
                />
              )
            })}
          </div>
        </div>
      </div>
      <div>
        <label
          className={cn(
            PANEL_BUTTON,
            'focus-within:outline-2 focus-within:outline-accent',
            uploading && 'pointer-events-none opacity-60',
          )}
        >
          <UploadSimpleIcon size={14} aria-hidden className="shrink-0" />
          <span>{uploading ? t.editor.fonts.uploading : t.editor.fonts.upload}</span>
          <input
            name="font-file"
            type="file"
            accept=".ttf,.otf,font/ttf,font/otf"
            className="sr-only"
            data-testid="font-upload"
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) void upload(file)
            }}
          />
        </label>
        {error && (
          <p role="alert" className="px-1 pt-1.5 text-tiny text-danger">
            {error}
          </p>
        )}
      </div>
    </div>
  )
}
