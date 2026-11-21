// Turns a Figma file's JSON, as Figma's REST API answers `GET /v1/files/:key?geometry=paths`, into
// Dazbee pages, frames and layers with an import report of what it left out or drew another way.

import { type DesignSize, FigmaImport } from '@dazbee/schema'

import { linkTarget } from './link-target.ts'
import { importPages } from './pages.ts'
import { type FigmaReadError, readFigmaFile } from './read.ts'
import { newReport } from './report.ts'

export { MAX_FIGMA_DEPTH, MAX_FIGMA_NODES } from './read.ts'

export type FigmaConvertError = FigmaReadError | 'node-missing' | 'nothing-to-import'

export interface FigmaToImportOptions {
  /** The node a link's `node-id` names, in the API's form (`1:2`); left out, the whole file. */
  nodeId?: string
}

export interface Converted {
  converted: FigmaImport
  /** The image fills' `imageRef`s the import's layers use. */
  imageRefs: string[]
  /** What the import adds to a design, counted as the design's own size is. */
  size: DesignSize
}

/** A Figma file's text as an import, or why it can't be one. */
export function figmaToImport(
  text: string,
  options: FigmaToImportOptions = {},
): Converted | { error: FigmaConvertError } {
  const file = readFigmaFile(text)
  if ('error' in file) return file
  const target = linkTarget(file.document, options.nodeId)
  if (!target) return { error: 'node-missing' }
  const report = newReport()
  const { pages, target: onto } = importPages(file.document, target, report)
  if (pages.length === 0) return { error: 'nothing-to-import' }
  const converted = FigmaImport.parse({ name: file.name, target: onto, pages, report: report.report() })
  const frames = converted.pages.flatMap((p) => p.frames)
  return {
    converted,
    imageRefs: [],
    size: {
      layers: frames.reduce((sum, f) => sum + Object.keys(f.layers?.nodes ?? {}).length, 0),
      frames: frames.length,
      pages: converted.pages.length,
      bytes: new TextEncoder().encode(JSON.stringify(converted)).length,
    },
  }
}
