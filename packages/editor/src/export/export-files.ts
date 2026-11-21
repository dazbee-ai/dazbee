// Exporting the design as this tab holds it as files, and Copy as PNG's picture, drawn in the
// export worker so the stage stays responsive.
import type { Session } from '@dazbee/doc'
import type { ExportedFile } from '@dazbee/export'
import type { ExportRequestInput } from '@dazbee/schema'

import type { EditorResources } from '../resources.ts'
import type { ExportClient } from './export-client.ts'
import type { EditorPngCopy, PngChoice } from './png-copy.ts'

export interface ExportFilesDeps {
  session: Pick<Session, 'design'>
  resources: Pick<EditorResources, 'bytesFor' | 'load' | 'loaded'>
  /** The export worker's client: exports are drawn in a worker of their own, started at the first one. */
  exporter: Pick<ExportClient, 'run'>
  /** What Copy as PNG takes and draws. */
  pngCopy: Pick<EditorPngCopy, 'chosen' | 'designOf' | 'pngToCopy'>
}

/** What the `Editor`'s `exportFiles` does, and what Copy as PNG draws with. */
export interface EditorExportFiles {
  files(request: ExportRequestInput, progress?: (done: number, total: number) => void): Promise<ExportedFile>
  /**
   * Copy as PNG's picture of what is chosen now, read at once, as PNG bytes: once the fonts and the
   * images it needs are here, so it is measured and drawn in them, drawn by the PNG export at its
   * scale on the CPU surface. It gives 'tooBig' when the export takes it at no scale, and null when it
   * draws nothing. Null at once with nothing chosen.
   */
  png(): Promise<Uint8Array | 'tooBig' | null> | null
}

export function editorExportFiles({ session, resources, exporter, pngCopy }: ExportFilesDeps): EditorExportFiles {
  async function exportFiles(request: ExportRequestInput, progress?: (done: number, total: number) => void) {
    // A family picked or an image placed a moment ago is drawn as itself, never the fallback or a gap.
    resources.load(session.design(), request.frameIds)
    await resources.loaded()
    // Drawn with the files of only the faces the design uses, as the API draws it.
    const design = session.design()
    return exporter.run(design, request, resources.bytesFor(design), progress)
  }

  function png() {
    const choice = pngCopy.chosen()
    return choice && drawPng(choice)
  }
  /** A choice's picture, as `png` says. */
  async function drawPng(choice: PngChoice) {
    const needs = pngCopy.designOf(choice)
    resources.load(needs.design, [needs.frameId])
    await resources.loaded()
    const copy = pngCopy.pngToCopy(choice)
    if (!copy || copy === 'tooBig') return copy
    const { design, frameId, scale } = copy
    const file = await exporter.run(design, { frameIds: [frameId], type: 'png', scale }, resources.bytesFor(design))
    return file.bytes
  }

  return {
    files: exportFiles,
    png,
  }
}
