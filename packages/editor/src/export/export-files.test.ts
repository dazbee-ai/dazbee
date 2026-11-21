import { describe, expect, it } from 'vitest'

import type { ResourceBytes } from '@dazbee/renderer'
import type { Design } from '@dazbee/schema'

import { editorExportFiles } from './export-files.ts'
import type { PngChoice, PngCopy } from './png-copy.ts'

const BYTES: ResourceBytes = { fonts: [], fallbackFamilies: [], images: {} }
/** A design the copy draws, named so the log tells it apart from the tab's own. */
const COPY = { meta: { designId: 'copy', name: 'Copy' }, pages: {}, frames: {}, nodes: {} } as unknown as Design
const TAB = { meta: { designId: 'tab', name: 'Tab' }, pages: {}, frames: {}, nodes: {} } as unknown as Design

/** A choice of layers, as Copy as PNG takes them. */
const LAYERS: PngChoice = { frame: { name: 'Square', width: 100, height: 100 }, tree: { nodes: {}, roots: ['a'] } }

/**
 * Exporting over resources and a worker that log what they are asked, in order, with Copy as PNG
 * taking `choice`, which is drawn from the design `needs`, and giving `copy` for it.
 */
function harness(choice: PngChoice | null, copy: PngCopy | 'tooBig' | null) {
  const log: string[] = []
  const files = editorExportFiles({
    session: { design: () => TAB },
    resources: {
      bytesFor: () => BYTES,
      load: (design, frameIds) => void log.push(`load ${design.meta.designId} ${frameIds.join(' ')}`),
      loaded: async () => {
        log.push('loaded')
        return undefined
      },
    },
    exporter: {
      run: async (design, request, bytes) => {
        log.push(`run ${design.meta.designId} ${JSON.stringify(request)} ${bytes === BYTES}`)
        return { name: 'Copy.png', type: 'image/png', bytes: new Uint8Array([1, 2, 3]) }
      },
    },
    pngCopy: {
      chosen: () => {
        log.push('chosen')
        return choice
      },
      designOf: () => ({ design: COPY, frameId: 'needs-frame' }),
      pngToCopy: (given) => {
        log.push(given === choice ? 'pngToCopy of the choice' : 'pngToCopy of another')
        return copy
      },
    },
  })
  return { files, log }
}

describe('editorExportFiles', () => {
  describe('png', () => {
    it('takes what is chosen at once, makes its picture once the fonts and images it needs are here, draws it as a PNG at its scale in the worker, and gives its bytes', async () => {
      const { files, log } = harness(LAYERS, { design: COPY, frameId: 'png-copy-frame', scale: 2 })
      const drawing = files.png()
      expect(log).toEqual(['chosen', 'load copy needs-frame', 'loaded'])
      expect(await drawing).toEqual(new Uint8Array([1, 2, 3]))
      expect(log).toEqual([
        'chosen',
        'load copy needs-frame',
        'loaded',
        'pngToCopy of the choice',
        'run copy {"frameIds":["png-copy-frame"],"type":"png","scale":2} true',
      ])
    })

    it('draws nothing when it is too big, or there is nothing to copy', async () => {
      expect(await harness(LAYERS, 'tooBig').files.png()).toBe('tooBig')
      expect(await harness(LAYERS, null).files.png()).toBeNull()
      const none = harness(null, null)
      expect(none.files.png()).toBeNull()
      expect(none.log).toEqual(['chosen'])
    })
  })
})
