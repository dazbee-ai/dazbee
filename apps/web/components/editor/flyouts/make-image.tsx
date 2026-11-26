'use client'

// Make an image, in the Assets flyout: a few words and one of three ratios become an AI image among the brand's
// images. The button's tooltip says the image's share of the workspace's AI and about how long it takes. An image
// being made shows as a tile here, read from the person's own jobs, so closing the panel or the tab stops nothing
// and a reopened panel shows it still, as does a tab the person comes back to; once it is made the library lists it. One that didn't come out says so, with
// Try again, which asks again with its own words and ratio. A job that isn't started says why above the button.
import { useCallback, useEffect, useRef, useState } from 'react'

import { type AiEstimate, IMAGE_RATIOS, type ImageRatio, type MyAiJob } from '@dazbee/schema'

import { buttonStyles } from '@/components/ui/button.tsx'
import { CircleNotchIcon, SparkIcon, WarningCircleIcon } from '@/components/ui/icons.tsx'
import { Tooltip } from '@/components/ui/tooltip.tsx'
import { cn } from '@/lib/cn.ts'
import { aiEstimate, myAiJobs, startAiJob } from '@/lib/editor/ai-client.ts'
import { briefKey, type BriefSaid, briefSaid } from '@/lib/editor/brief-box.ts'
import { estimateWords, imageTiles, madeImages, RATIO_SHAPES, tileWords } from '@/lib/editor/make-image.ts'
import { useMessages } from '@/lib/i18n/client.tsx'

/** How often the box reads the person's jobs while an image is being made. */
const POLL_MS = 3000

/** `onMade` is called when an image job of the person's ends with its image, so the library lists it. */
export function MakeImage({
  workspaceId,
  brandId,
  onMade,
}: {
  workspaceId: string
  brandId: string
  onMade: () => void
}) {
  const { makeImage: t, brief } = useMessages().editor
  const [words, setWords] = useState('')
  const [ratio, setRatio] = useState<ImageRatio>('square')
  const [starting, setStarting] = useState(false)
  const [said, setSaid] = useState<BriefSaid | null>(null)
  // The person's own jobs on the brand, newest first; null until they are first read.
  const [jobs, setJobs] = useState<MyAiJob[] | null>(null)
  const [estimate, setEstimate] = useState<AiEstimate | null>(null)

  const read = useCallback(
    () =>
      myAiJobs(workspaceId, brandId)
        .then(setJobs)
        // Offline: the tiles keep what they showed.
        .catch(() => undefined),
    [workspaceId, brandId],
  )
  useEffect(() => {
    void read()
    aiEstimate(workspaceId, brandId, { action: 'image' })
      .then(setEstimate)
      // The tooltip keeps the button's name.
      .catch(() => undefined)
  }, [read, workspaceId, brandId])

  // A tab the person comes back to reads again: an image asked for in another tab shows here too.
  useEffect(() => {
    const back = () => {
      if (document.visibilityState === 'visible') void read()
    }
    document.addEventListener('visibilitychange', back)
    window.addEventListener('focus', back)
    return () => {
      document.removeEventListener('visibilitychange', back)
      window.removeEventListener('focus', back)
    }
  }, [read])

  const tiles = imageTiles(jobs ?? [])
  const working = tiles.some((tile) => tile.state === 'working')
  useEffect(() => {
    if (!working) return
    const timer = setInterval(() => void read(), POLL_MS)
    return () => clearInterval(timer)
  }, [working, read])

  // The images made as last read: one more than before is a job that just ended.
  const made = jobs ? madeImages(jobs).join(' ') : null
  const madeBefore = useRef<string | null>(null)
  useEffect(() => {
    if (made === null) return
    if (madeBefore.current !== null && madeBefore.current !== made) onMade()
    madeBefore.current = made
  }, [made, onMade])

  const make = async (asked: { words: string; ratio: ImageRatio }) => {
    if (!asked.words || starting) return
    setStarting(true)
    setSaid(null)
    const started = await startAiJob(workspaceId, brandId, { kind: 'image', ...asked }).catch(
      () => ({ ok: false, refusal: null, unknown: true }) as const,
    )
    if (!started.ok) {
      setStarting(false)
      setSaid(briefSaid(started))
      return
    }
    // The words clear once the job's tile is read, so the box never shows neither.
    await read()
    setWords((now) => (now.trim() === asked.words ? '' : now))
    setStarting(false)
  }
  const typed = { words: words.trim(), ratio }
  // Used up, paused and not allowed are said in the brief box's words; the rest name the image.
  const note = said === 'notStarted' || said === 'unknown' ? t[said] : said && said !== 'notPlaced' ? brief[said] : null

  return (
    <div data-testid="make-image" className="flex flex-col gap-2">
      <form
        aria-label={t.label}
        className="flex flex-col gap-1.5 rounded-[10px] border border-line bg-bg/40 p-2 focus-within:border-accent"
        onSubmit={(e) => {
          e.preventDefault()
          void make(typed)
        }}
      >
        <textarea
          name="image-words"
          rows={2}
          maxLength={2000}
          value={words}
          onChange={(e) => setWords(e.target.value)}
          onKeyDown={(e) => {
            if (briefKey({ key: e.key, shiftKey: e.shiftKey, isComposing: e.nativeEvent.isComposing }) !== 'make')
              return
            e.preventDefault()
            void make(typed)
          }}
          aria-label={t.label}
          placeholder={t.placeholder}
          className="min-h-0 resize-none bg-transparent text-small outline-none placeholder:text-subtle"
        />
        <div className="flex items-center gap-1">
          <div role="radiogroup" aria-label={t.ratios} className="flex gap-0.5">
            {IMAGE_RATIOS.map((each) => (
              <button
                key={each}
                type="button"
                role="radio"
                aria-checked={ratio === each}
                aria-label={t[each]}
                title={t[each]}
                onClick={() => setRatio(each)}
                className="grid size-7 cursor-pointer place-items-center rounded-row text-subtle transition-colors duration-[var(--chrome-fast)] hover:bg-hover hover:text-text aria-checked:bg-accent-soft aria-checked:text-accent-text"
              >
                <span aria-hidden className="rounded-[2px] border-[1.5px] border-current" style={RATIO_SHAPES[each]} />
              </button>
            ))}
          </div>
          <span className="flex-1" />
          <Tooltip plain side="bottom" label={estimateWords(estimate, t)}>
            <button
              type="submit"
              disabled={!typed.words || starting}
              className={cn(buttonStyles({ variant: 'primary', size: 'md' }), 'h-7 gap-1.5 px-2.5 text-tiny')}
            >
              <SparkIcon size={13} aria-hidden />
              {starting ? t.starting : t.make}
            </button>
          </Tooltip>
        </div>
        {note && (
          <p role="alert" data-testid="make-image-said" className="text-tiny text-muted">
            {note}
          </p>
        )}
      </form>
      {tiles.length > 0 && (
        <ul aria-label={t.label} className="flex flex-col gap-1.5" data-testid="make-image-tiles">
          {tiles.map((tile) => (
            <li
              key={tile.job}
              data-state={tile.state}
              className="flex items-center gap-2 rounded-[10px] border border-line bg-bg/40 px-2 py-1.5 text-tiny"
            >
              {tile.state === 'working' ? (
                <CircleNotchIcon size={14} aria-hidden className="shrink-0 animate-spin text-subtle" />
              ) : (
                <WarningCircleIcon size={14} aria-hidden className="shrink-0 text-danger" />
              )}
              <span
                role={tile.state === 'failed' ? 'alert' : 'status'}
                className="min-w-0 flex-1 text-muted"
                title={tileWords(tile, t)}
              >
                <span className="line-clamp-2">{tileWords(tile, t)}</span>
              </span>
              {tile.state === 'failed' && (
                <button
                  type="button"
                  disabled={starting}
                  onClick={() => void make({ words: tile.words, ratio: tile.ratio })}
                  className="shrink-0 cursor-pointer rounded-row px-1.5 py-1 font-semibold text-accent-text hover:bg-hover active:bg-pressed disabled:opacity-45"
                >
                  {t.tryAgain}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
