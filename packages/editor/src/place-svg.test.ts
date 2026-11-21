import { describe, expect, it, vi } from 'vitest'

import type { Session } from '@dazbee/doc'
import type { Point } from '@dazbee/schema'
import { hugePath, NESTED_BLURS } from '@dazbee/svg/test-hostile-files'

import type { Spot } from './canvas/view.ts'
import type { EditorPlaceSvg } from './place-svg.ts'
import { firstFrameOf, pairsIn } from './selection.ts'
import { harness, SVG } from './test-place.ts'
import { photoSvg, uploader } from './test-place-svg.ts'

/** Reads a file and places it at once, as a caller does once nothing is open on the stage. */
async function placed(svg: EditorPlaceSvg, text: string, name: string, where?: Point | Spot) {
  const read = await svg.readSvg(text, name, where)
  return read && svg.placeSvg(read)
}

/** The assets the image fills of the design name, in the order of its layers. */
function imageAssets(session: Session) {
  return Object.values(session.design().nodes).flatMap((node) =>
    'fills' in node.props ? (node.props.fills ?? []).flatMap((f) => (f.type === 'image' ? [f.assetId] : [])) : [],
  )
}

describe('editorPlaceSvg', () => {
  describe('placeSvg', () => {
    it('places a file as a group centred on a spot, selected, with the select tool back', async () => {
      const { svg, session, selection, square, boxOf, log } = harness()
      const id = await placed(svg, SVG, 'Logo', { frameId: square.id, x: 500, y: 500 })
      expect(id).not.toBeNull()
      expect(session.design().nodes[id ?? '']).toMatchObject({ type: 'group', name: 'Logo', parentId: 'sq' })
      expect(boxOf(id ?? '')).toEqual({ x: 450, y: 475, width: 100, height: 50 })
      expect(selection.current()).toEqual(pairsIn(square.id, [id ?? '']))
      expect(log).toEqual(['typing stop', 'tool select'])
    })

    it('places a file centred on a stage point, and in the middle of the selection’s frame for a point off every frame', async () => {
      const { svg, selection, square, boxOf, stage } = harness()
      const id = await placed(svg, SVG, 'Logo', stage(square, 500, 500))
      expect(boxOf(id ?? '')).toEqual({ x: 450, y: 475, width: 100, height: 50 })
      expect(selection.current()).toEqual(pairsIn(square.id, [id ?? '']))
      const off = await placed(svg, SVG, 'Logo', { x: -500, y: -500 })
      expect(boxOf(off ?? '')).toEqual({ x: 490, y: 515, width: 100, height: 50 })
      expect(selection.current()).toEqual(pairsIn(square.id, [off ?? '']))
    })

    it('goes in the middle of the frame in view with no point', async () => {
      const { svg, selection, wide } = harness()
      await placed(svg, SVG, 'Logo')
      expect(firstFrameOf(selection.current())).toBe(wide.id)
    })

    it('scales a file larger than 60% of the frame’s shorter side down to that, its layers with it, centred the same way', async () => {
      const { svg, session, square, boxOf } = harness()
      const wide =
        '<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="1000"><rect id="Wide" width="2000" height="1000"/></svg>'
      const id = (await placed(svg, wide, 'SVG', { frameId: square.id, x: 540, y: 540 })) ?? ''
      expect(boxOf(id)).toEqual({ x: 216, y: 378, width: 648, height: 324 })
      const [inside = ''] = Object.keys(session.design().nodes).filter(
        (n) => session.design().nodes[n]?.parentId === id,
      )
      expect(session.design().nodes[inside]?.name).toBe('Wide')
      expect(boxOf(inside)).toEqual({ x: 216, y: 378, width: 648, height: 324 })
    })

    it('leaves out the pictures a file embeds when there is nothing to upload them with, and says so', async () => {
      const { svg, session, square, log } = harness()
      const id = await placed(svg, photoSvg(2), 'Photo', { frameId: square.id, x: 500, y: 500 })
      expect(id).not.toBeNull()
      expect(imageAssets(session)).toEqual([])
      expect(JSON.stringify(session.design().nodes)).not.toContain('svg-image-')
      expect(log).toEqual(['typing stop', 'tool select', 'svgLeftOut image'])
    })

    it('says so and places nothing when the file can’t be read', async () => {
      const { svg, session, log } = harness()
      expect(await svg.readSvg('<html></html>', 'Page')).toBeNull()
      expect(log).toEqual(['svgUnreadable'])
      expect(session.canUndo()).toBe(false)
    })

    it('refuses 50 nested blurs and one path of 630,000 points as it refuses a file it can’t read, placing nothing', async () => {
      const { svg, session, log } = harness()
      for (const file of [NESTED_BLURS, hugePath()]) expect(await svg.readSvg(file, 'Hostile')).toBeNull()
      expect(log).toEqual(['svgUnreadable', 'svgUnreadable'])
      expect(session.canUndo()).toBe(false)
    })
  })

  describe('readSvg with an uploader', () => {
    it('uploads each distinct picture once, at most 4 at a time, named after the file and its layer, then places it all as one undo step whose fills name the uploaded assets', async () => {
      const uploads = uploader({ hold: true })
      const { svg, session, square, log } = harness(false, { upload: uploads.upload })
      // Six pictures, the first shown twice.
      const reading = svg.readSvg(photoSvg(6, { twice: true }), 'Card', { frameId: square.id, x: 500, y: 500 })
      await vi.waitFor(() => expect(uploads.calls).toHaveLength(4))
      expect(log).toEqual(['uploading 6'])
      expect(session.canUndo()).toBe(false)
      uploads.release()
      const read = await reading
      expect(uploads.calls).toEqual(
        [1, 2, 3, 4, 5, 6].map((n) => ({ type: 'image/png', name: `Photo ${n} · Card`, bytes: 33 })),
      )
      expect(uploads.most()).toBe(4)
      expect(log).toEqual(['uploading 6', 'uploading 0'])

      const id = read && svg.placeSvg(read)
      expect(id).not.toBeNull()
      const assets = ['asset-1', 'asset-2', 'asset-3', 'asset-4', 'asset-5', 'asset-6', 'asset-1']
      expect(imageAssets(session)).toEqual(assets)
      expect(JSON.stringify(session.design().nodes)).not.toContain('svg-image-')
      expect(log).toEqual(['uploading 6', 'uploading 0', 'typing stop', 'tool select'])
      // One undo takes the file away, uploads and all placed; one redo puts it back.
      session.undo()
      expect(session.design().nodes[id ?? '']).toBeUndefined()
      expect(session.canUndo()).toBe(false)
      session.redo()
      expect(imageAssets(session)).toEqual(assets)
    })

    it('says a picture that didn’t upload was left out, and places the rest, no paint keeping a picture’s key', async () => {
      const uploads = uploader({ fail: ['Photo 2 · Card'] })
      const { svg, session, square, log } = harness(false, { upload: uploads.upload })
      expect(await placed(svg, photoSvg(3), 'Card', { frameId: square.id, x: 500, y: 500 })).not.toBeNull()
      expect(uploads.calls).toHaveLength(3)
      expect(imageAssets(session)).toEqual(['asset-1', 'asset-3'])
      expect(Object.values(session.design().nodes).map((n) => n.name)).not.toContain('Photo 2')
      expect(JSON.stringify(session.design().nodes)).not.toContain('svg-image-')
      expect(log.at(-1)).toBe('svgLeftOut notUploaded 1')
    })

    it('uploads only the pictures a layer can show, and says a GIF was left out', async () => {
      const uploads = uploader()
      const { svg, session, square, log } = harness(false, { upload: uploads.upload })
      await placed(svg, photoSvg(1, { gif: true }), 'Card', { frameId: square.id, x: 500, y: 500 })
      expect(uploads.calls.map((c) => c.name)).toEqual(['Photo 1 · Card'])
      expect(imageAssets(session)).toEqual(['asset-1'])
      expect(log).toEqual(['uploading 1', 'uploading 0', 'typing stop', 'tool select', 'svgLeftOut image'])
    })

    it('uploads nothing for a file without pictures, and tells of no upload', async () => {
      const uploads = uploader()
      const { svg, square, log } = harness(false, { upload: uploads.upload })
      await placed(svg, SVG, 'Logo', { frameId: square.id, x: 500, y: 500 })
      expect(uploads.calls).toEqual([])
      expect(log).toEqual(['typing stop', 'tool select'])
    })

    it('uploads the pictures of pasted markup the same way, then places it as one undo step', async () => {
      const uploads = uploader()
      const { place, session, log } = harness(false, { upload: uploads.upload })
      expect(place.paste({ text: photoSvg(2) }, () => null)).toBe(true)
      await vi.waitFor(() => expect(imageAssets(session)).toEqual(['asset-1', 'asset-2']))
      expect(uploads.calls.map((c) => c.name)).toEqual(['Photo 1 · SVG', 'Photo 2 · SVG'])
      expect(log).toEqual(['uploading 2', 'uploading 0', 'typing stop', 'tool select'])
      session.undo()
      expect(imageAssets(session)).toEqual([])
      expect(session.canUndo()).toBe(false)
    })
  })

  describe('whenSettled', () => {
    it('ends a pen path 3 seconds on, though a hidden tab checks again only once a second', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] })
      try {
        let pen = true
        const { svg } = harness(false, {
          open: { gesturing: () => pen, dragging: () => false, stopEditing: () => {}, settle: () => (pen = false) },
          // A hidden tab runs a timer a second late at the soonest.
          after: (ms, run) => {
            const timer = setTimeout(run, Math.max(ms, 1000))
            return () => clearTimeout(timer)
          },
        })
        const settling = svg.whenSettled()
        await vi.advanceTimersByTimeAsync(2_500)
        expect(pen).toBe(true)
        await vi.advanceTimersByTimeAsync(1_000)
        expect(pen).toBe(false)
        expect(await settling).toBe(true)
      } finally {
        vi.useRealTimers()
      }
    })
  })
})
