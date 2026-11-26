'use client'

// The open flyout's card, beside the stage on a tablet or desktop and above the tab bar on a phone: its title,
// the small grey note its content sets, Close, and what it shows.
import { AnimatePresence, motion, type Transition } from 'motion/react'
import {
  createContext,
  type ReactNode,
  type RefObject,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'

import { EmptyState } from '@/components/ui/empty-state.tsx'
import { XIcon } from '@/components/ui/icons.tsx'
import { cn } from '@/lib/cn.ts'
import { useMessages } from '@/lib/i18n/client.tsx'

import { type Flyout, setFlyout, setFlyoutEnd } from './edit-store.ts'
import { UNDER_TOOL_TRAY } from './styles.ts'

type Note = { owner: object; text: string } | null

/** Lets the open flyout's content set the small grey note in its title row, as Layers does with its page and frame. */
const FlyoutNote = createContext<(change: (now: Note) => Note) => void>(() => undefined)

/**
 * Shows a note at the end of the open flyout's title row while the caller is mounted. A flyout
 * fading out clears only its own note, never the next one's.
 */
export function useFlyoutNote(text: string | null) {
  const setNote = useContext(FlyoutNote)
  const [owner] = useState(() => ({}))
  useEffect(() => {
    setNote(() => (text ? { owner, text } : null))
    return () => setNote((now) => (now?.owner === owner ? null : now))
  }, [setNote, owner, text])
}

// The open flyout, after the dock it opens from, so Tab reaches it from its button; on a phone,
// after the tab bar.
export function FlyoutCard({
  flyout,
  title: flyoutTitle,
  brandName,
  flyouts,
  chrome,
  phone,
  rtl,
  stage,
}: {
  flyout: Flyout | null
  title: (id: Flyout) => string
  brandName: string
  flyouts: Partial<Record<Flyout, ReactNode>> | undefined
  chrome: Transition
  phone: boolean
  rtl: boolean
  stage: RefObject<HTMLElement | null>
}) {
  const t = useMessages()
  const [flyoutNote, setNote] = useState<Note>(null)
  const note = flyoutNote?.text ?? null
  const flyoutEmpty = {
    layers: t.editor.layersEmpty,
    assets: t.editor.assetsEmpty,
    brand: t.editor.brandEmpty,
  }
  const flyoutEl = useRef<HTMLElement>(null)
  useLayoutEffect(() => {
    const el = flyoutEl.current
    if (!flyout || phone || !el || !stage.current) {
      setFlyoutEnd(null)
      return
    }
    // Where the flyout rests, from its layout box, which its slide in doesn't move.
    const measure = () => {
      const area = stage.current
      if (!area) return
      setFlyoutEnd(
        Math.round(
          rtl ? area.offsetLeft + area.offsetWidth - el.offsetLeft : el.offsetLeft + el.offsetWidth - area.offsetLeft,
        ),
      )
    }
    measure()
    const watch = new ResizeObserver(measure)
    watch.observe(el)
    return () => {
      watch.disconnect()
      setFlyoutEnd(null)
    }
  }, [flyout, phone, rtl])

  return (
    <AnimatePresence>
      {flyout && (
        <motion.section
          ref={flyoutEl}
          key={flyout}
          id="editor-flyout"
          aria-label={flyoutTitle(flyout)}
          initial={{ opacity: 0, x: rtl ? 12 : -12 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: rtl ? 12 : -12 }}
          transition={chrome}
          data-testid="flyout"
          // At the start island's inset from the stage's edge, under the islands, ending clear of
          // the dock, and on a tablet of the zoom pill and Pages above it. On a phone, a sheet
          // above the tab bar and under the header's islands, which end 5.5rem down.
          className={cn(
            'absolute start-6 top-20 z-10 flex max-h-[calc(100%-5rem-var(--above-dock))] w-[21.5rem] sm:max-lg:max-h-[calc(100%-5rem-var(--above-corner))] flex-col sm:rtl:start-4 overflow-hidden rounded-[16px] surface-frost max-sm:inset-x-3 max-sm:start-3 max-sm:top-auto max-sm:bottom-(--above-tab-bar) max-sm:max-h-[calc(100%-var(--above-tab-bar)-5.5rem)] max-sm:w-auto',
            UNDER_TOOL_TRAY,
          )}
        >
          {/* The title at the start and, as in the mock, a small grey note at the end: the brand, or the page and frame. */}
          <div className="flex h-14 shrink-0 items-center gap-2 ps-[18px] pe-2">
            <h2
              className={cn(
                'min-w-0 flex-1 truncate font-display text-lead font-bold tracking-tight',
                flyout === 'ai' && 'text-accent-text',
              )}
            >
              {flyoutTitle(flyout)}
            </h2>
            {(note ?? (flyout === 'assets' || flyout === 'brand' ? brandName : null)) && (
              <span
                data-testid="flyout-note"
                className="min-w-0 max-w-[60%] truncate text-caption font-medium text-muted"
              >
                {note ?? brandName}
              </span>
            )}
            <button
              type="button"
              aria-label={t.editor.closePanel}
              onClick={() => setFlyout(null)}
              // A finger's target on a phone or a touch screen.
              className="grid size-7 shrink-0 cursor-pointer place-items-center rounded-full text-subtle hover:bg-hover hover:text-text active:bg-pressed max-sm:size-[44px] [@media(hover:none)]:size-[44px]"
            >
              <XIcon size={14} aria-hidden />
            </button>
          </div>
          <FlyoutNote.Provider value={setNote}>
            {flyouts?.[flyout] ??
              (flyout === 'ai' ? (
                <EmptyState pose="build" tight {...t.editor.aiEmpty} />
              ) : (
                <p className="px-[18px] pb-4 text-small text-muted">{flyoutEmpty[flyout]}</p>
              ))}
          </FlyoutNote.Provider>
        </motion.section>
      )}
    </AnimatePresence>
  )
}
