'use client'

// The picture versions of a picked AI frame's picture layer, beside the frame: a column of small pictures to its
// right, the first picture first, then each refine's new version, the latest of those the layer shows now outlined.
// A click puts that version back into the picture layer, as the person's own step, one undo step. Shown once the
// layer has more than one version, in a tab that may change the design.
import { useState } from 'react'

import { type Editor, shownPicture } from '@dazbee/editor'

import { useDesignAi } from '@/components/editor/editor-hooks.ts'
import { useLiveDesign } from '@/components/editor/use-live-design.ts'
import { useWheelThrough } from '@/components/editor/wheel-through.ts'
import { brandPath } from '@/lib/brand-routes.ts'
import { cn } from '@/lib/cn.ts'
import { pictureVersions } from '@/lib/editor/refine.ts'
import { useMessages } from '@/lib/i18n/client.tsx'
import { format } from '@/lib/i18n/index.ts'

import { useFrameRect } from './frame-rect.ts'

/** A version's picture's side, in pixels. */
const THUMB = 52
/** Pixels between the frame and the column. */
const GAP = 12

export function PictureVersions({
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
  const versions = pictureVersions(ai, frameId, layerId)
  const layer = design.nodes[layerId]
  const current = layer ? shownPicture(layer) : null
  // The latest version showing that picture is the one outlined: a picture may come back in a later version.
  const outlined = versions.findLastIndex((version) => version.assetId === current)
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
            aria-current={n === outlined ? 'true' : undefined}
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
