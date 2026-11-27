'use client'

// The versions of a picked AI frame's picture, beside the frame: a column of small pictures to its right, the first
// version first, then each refine's new version, the one the frame shows now outlined. A click puts that version
// back into the picture layer, as the person's own step, one undo step. Shown once a frame has more than one version,
// in a tab that may change the design.
import { useState } from 'react'

import type { Editor } from '@dazbee/editor'
import type { Paint } from '@dazbee/schema'

import { useDesignAi } from '@/components/editor/editor-hooks.ts'
import { useFrameRect } from '@/components/editor/frame-rect.ts'
import { useLiveDesign } from '@/components/editor/use-live-design.ts'
import { useWheelThrough } from '@/components/editor/wheel-through.ts'
import { brandPath } from '@/lib/brand-routes.ts'
import { cn } from '@/lib/cn.ts'
import { frameVersions } from '@/lib/editor/refine.ts'
import { useMessages } from '@/lib/i18n/client.tsx'
import { format } from '@/lib/i18n/index.ts'

/** A version's picture's side, in pixels. */
const THUMB = 52
/** Pixels between the frame and the column. */
const GAP = 12

export function VersionStrip({
  workspaceId,
  brandId,
  editor,
  frameId,
  layerId,
}: {
  workspaceId: string
  brandId: string
  editor: Editor
  frameId: string
  /** The picture layer the versions are put back into. */
  layerId: string
}) {
  const r = useMessages().editor.refine
  const ai = useDesignAi(editor)
  const { design } = useLiveDesign(editor)
  const [strip, setStrip] = useState<HTMLElement | null>(null)
  const rect = useFrameRect(editor, frameId, strip)
  useWheelThrough(strip)
  const versions = frameVersions(ai, frameId)
  const layer = design.nodes[layerId]
  const fills = layer && 'fills' in layer.props ? (layer.props.fills as Paint[]) : []
  const shown = fills.find((fill) => fill.type === 'image')
  const current = shown?.type === 'image' ? shown.assetId : null
  if (versions.length < 2 || !layer) return null
  return (
    <ol
      ref={setStrip}
      aria-label={r.versions}
      data-testid="version-strip"
      style={rect ? { left: rect.right + GAP, top: rect.top } : undefined}
      className={cn(
        'absolute z-20 flex max-h-[60vh] flex-col gap-1.5 overflow-y-auto rounded-[14px] surface-frost p-1.5',
        rect ? 'visible' : 'invisible',
      )}
    >
      {versions.map((version, n) => (
        <li key={`${version.refineId ?? 'first'}-${version.assetId}`}>
          <button
            type="button"
            aria-label={n === 0 ? r.first : format(r.version, { n: n + 1 })}
            aria-current={version.assetId === current ? 'true' : undefined}
            data-asset={version.assetId}
            onClick={() =>
              version.assetId !== current &&
              editor.session.run('node.update', {
                ids: [layerId],
                patch: { fills: [{ type: 'image', assetId: version.assetId, fit: 'fill' }] },
              })
            }
            className="block cursor-pointer overflow-hidden rounded-[8px] outline-offset-2 aria-[current=true]:outline-2 aria-[current=true]:outline-(--stage-accent)"
            style={{ width: THUMB, height: THUMB }}
          >
            <img
              src={brandPath(workspaceId, brandId, 'assets', version.assetId, 'thumbnail')}
              alt=""
              className="size-full object-cover"
            />
          </button>
        </li>
      ))}
    </ol>
  )
}
