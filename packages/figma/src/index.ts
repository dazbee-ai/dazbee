// Turns a Figma file's JSON, as Figma's REST API answers `GET /v1/files/:key?geometry=paths`, into
// Dazbee pages, frames and layers with an import report of what it left out or drew another way.

import type { CanvasKit } from '@dazbee/canvaskit'
import { type DesignSize, type FigmaFrame, FigmaImport, type Paint } from '@dazbee/schema'

import { linkTarget } from './link-target.ts'
import { importPages } from './pages.ts'
import { type FigmaReadError, readFigmaFile } from './read.ts'
import { newReport } from './report.ts'

export { MAX_FIGMA_DEPTH, MAX_FIGMA_NODES } from './read.ts'

/** Why a file can't be imported; `not-convertible` when what it became breaks the import's own rules. */
export type FigmaConvertError = FigmaReadError | 'node-missing' | 'nothing-to-import' | 'not-convertible'

export interface FigmaToImportOptions {
  /** The node a link's `node-id` names, in the API's form (`1:2`); left out, the whole file. */
  nodeId?: string
}

/**
 * A file as the import holds it before its images are fetched. Its image paints hold their Figma
 * `imageRef` as their asset id, and a stretched image's crop in shares of the image, until
 * `withImages` gives each its asset and sizes its crop by the image.
 */
export interface ConvertedFile {
  converted: FigmaImport
  /** The image fills' `imageRef`s the import's frames and layers use, each once. */
  imageRefs: string[]
  /** What the import adds to a design, counted as the design's own size is. */
  size: DesignSize
}

/** A Figma file's text as an import, or why it can't be one; `ck` reads and places its paths. */
export function figmaToImport(
  ck: CanvasKit,
  text: string,
  options: FigmaToImportOptions = {},
): ConvertedFile | { error: FigmaConvertError } {
  const file = readFigmaFile(text)
  if ('error' in file) return file
  const target = linkTarget(file.document, options.nodeId)
  if (!target) return { error: 'node-missing' }
  const report = newReport()
  const { pages, target: onto } = importPages(file.document, target, report, ck)
  if (pages.length === 0) return { error: 'nothing-to-import' }
  const parsed = FigmaImport.safeParse({ name: file.name, target: onto, pages, report: report.report() })
  if (!parsed.success) return { error: 'not-convertible' }
  const converted = parsed.data
  const frames = converted.pages.flatMap((p) => p.frames)
  return {
    converted,
    imageRefs: imageRefsOf(frames),
    size: {
      layers: frames.reduce((sum, f) => sum + Object.keys(f.layers?.nodes ?? {}).length, 0),
      frames: frames.length,
      pages: converted.pages.length,
      sections: 0,
      connectors: 0,
      bytes: new TextEncoder().encode(JSON.stringify(converted)).length,
    },
  }
}

/** The `imageRef`s the frames' image paints hold, each once, in the order first met. */
function imageRefsOf(frames: readonly FigmaFrame[]): string[] {
  const refs = new Set<string>()
  const add = (paints: readonly Paint[]) => {
    for (const p of paints) if (p.type === 'image') refs.add(p.assetId)
  }
  for (const f of frames) {
    add(f.fills)
    for (const layer of Object.values(f.layers?.nodes ?? {})) {
      const props = layer.props as { fills?: Paint[]; strokes?: { paint: Paint }[] }
      add(props.fills ?? [])
      add((props.strokes ?? []).map((s) => s.paint))
    }
  }
  return [...refs]
}
