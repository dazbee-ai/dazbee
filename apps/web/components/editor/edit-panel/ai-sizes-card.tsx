'use client'

// The Add size card of an AI frame: the sizes the AI is offered (from 1:3 to 3:1) as tiles three across, grouped by
// channel, each picked or let go with a click, then Redraw N sizes with AI, which redraws the frame's picture at each
// size picked as a new section right of the frame's, joined to it, its frames filling as the pictures arrive. On a
// frame made editable it is the other choice beside Add size as on any frame. Hovering Redraw shows about how much of
// the workspace's AI it takes for the sizes picked, and how long.
import { useState } from 'react'

import type { Editor } from '@dazbee/editor'
import { type AiEstimate, SIZE_CHANNELS, SIZE_PRESETS } from '@dazbee/schema'

import { setOpen } from '@/components/editor/edit-store.ts'
import { SizeText } from '@/components/editor/size-text.tsx'
import { PANEL_HEADING } from '@/components/editor/styles.ts'
import { FOCUS_RING, LIT_ROW } from '@/components/ui/looks.ts'
import { Tooltip } from '@/components/ui/tooltip.tsx'
import { cn } from '@/lib/cn.ts'
import { aiEstimate } from '@/lib/editor/ai-client.ts'
import { aiSizes } from '@/lib/editor/ai-sizes.ts'
import { briefSaid } from '@/lib/editor/brief-box.ts'
import { estimateWords } from '@/lib/editor/glass-bar.ts'
import { useLocale, useMessages } from '@/lib/i18n/client.tsx'
import { counted, format } from '@/lib/i18n/index.ts'

import { PanelFrame } from './edit-panel.tsx'

/** The sizes the AI is offered, from the Add a frame card's list. */
const OFFERED = aiSizes(SIZE_PRESETS)
/** The longest side of a tile's outlined shape, in pixels. */
const TILE_SHAPE = 40

export function AiSizesCard({
  workspaceId,
  brandId,
  editor,
  frame,
}: {
  workspaceId: string
  brandId: string
  editor: Editor
  frame: { id: string; name: string }
}) {
  const t = useMessages()
  const locale = useLocale()
  const a = t.editor.addFrame
  const s = t.editor.aiSizes
  const [picked, setPicked] = useState<readonly string[]>([])
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState<string | null>(null)
  const [estimate, setEstimate] = useState<AiEstimate | null>(null)
  const sizes = OFFERED.filter((preset) => picked.includes(preset.id))
  const toggle = (id: string) => {
    setPicked((now) => (now.includes(id) ? now.filter((p) => p !== id) : [...now, id]))
    setEstimate(null)
  }

  async function redraw() {
    setBusy(true)
    setSaid(null)
    try {
      const started = await editor.otherSizes({
        frameId: frame.id,
        sizes: sizes.map((size) => ({ width: size.width, height: size.height, name: t.editor.sizes.preset[size.id] })),
        title: format(s.title, { name: frame.name }),
      })
      if (!started.ok) {
        setSaid(started.refusal ? t.editor.brief[briefSaid(started)] : s.notStarted)
        return
      }
      setOpen(null)
      editor.fitSection(started.sectionId)
    } catch {
      setSaid(s.notStarted)
    } finally {
      setBusy(false)
    }
  }

  const ask = () => {
    if (estimate || sizes.length === 0) return
    const asked = sizes.map(({ width, height }) => ({ width, height }))
    aiEstimate(workspaceId, brandId, { action: 'resize', sizes: asked })
      .then(setEstimate)
      .catch(() => {
        // No estimate: the tooltip keeps the action's name.
      })
  }
  const redrawLabel = counted(locale, s.redraw, sizes.length)

  return (
    <PanelFrame id="addSize" title={format(a.addSizeTitle, { name: frame.name })} focus>
      <p data-testid="ai-sizes-note" className="px-[8px] text-label leading-[1.4] text-subtle">
        {format(s.note, { name: frame.name })}
      </p>
      {SIZE_CHANNELS.map((channel) => {
        const tiles = OFFERED.filter((preset) => preset.channel === channel)
        if (tiles.length === 0) return null
        return (
          <section key={channel} aria-label={t.editor.sizes.channel[channel]} className="flex flex-col gap-[8px]">
            <h3 className={cn(PANEL_HEADING, 'px-[8px]')}>{t.editor.sizes.channel[channel]}</h3>
            <div className="grid grid-cols-3 gap-0.5" data-testid={`ai-sizes-${channel}`}>
              {tiles.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  data-preset={preset.id}
                  aria-pressed={picked.includes(preset.id)}
                  onClick={() => toggle(preset.id)}
                  className={cn(
                    'group flex min-w-0 cursor-pointer flex-col items-center gap-[4px] rounded-[10px] px-1 pt-[11px] pb-[11px] text-center text-text aria-pressed:bg-accent-soft',
                    LIT_ROW,
                    FOCUS_RING,
                  )}
                >
                  <span aria-hidden className="grid h-[40px] place-items-center">
                    <span
                      style={shapeOf(preset)}
                      className="block rounded-[2px] border-[1.5px] border-subtle group-aria-pressed:border-accent"
                    />
                  </span>
                  <span className="flex min-h-[2.4em] max-w-full items-center text-caption leading-[1.2] font-medium">
                    {t.editor.sizes.preset[preset.id]}
                  </span>
                  <SizeText size={preset} className="font-mono text-tiny leading-none text-subtle tabular-nums" />
                </button>
              ))}
            </div>
          </section>
        )
      })}
      {said && (
        <p role="status" data-testid="ai-sizes-said" className="px-[8px] text-tiny text-muted">
          {said}
        </p>
      )}
      <div className="flex flex-col gap-1.5 px-[8px]">
        <Tooltip label={estimateWords(estimate, redrawLabel, t.editor.glass)}>
          <button
            type="button"
            data-action="redraw-sizes"
            disabled={sizes.length === 0 || busy}
            onPointerEnter={ask}
            onFocus={ask}
            onClick={() => void redraw()}
            className="h-[34px] cursor-pointer rounded-row bg-accent-solid px-[15px] text-label font-semibold text-on-accent hover:bg-accent-solid-hover disabled:cursor-not-allowed disabled:opacity-45"
          >
            {redrawLabel}
          </button>
        </Tooltip>
      </div>
    </PanelFrame>
  )
}

/** A size's outline, as long as a tile's shape on its long side. */
function shapeOf({ width, height }: { width: number; height: number }) {
  const k = TILE_SHAPE / Math.max(width, height)
  return { width: Math.max(4, Math.round(width * k)), height: Math.max(3, Math.round(height * k)) }
}
