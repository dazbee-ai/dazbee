import { describe, expect, it } from 'vitest'

import { pairsIn } from './selection.ts'
import { BLUE, harness, PHOTO, RED } from './test-place.ts'

describe('editorPlace', () => {
  describe('dropTarget and imageTarget', () => {
    it('outlines the shape or box an image dragged over the stage would go into', () => {
      const { place, square, log, stage } = harness()
      expect(place.imageTarget(stage(square, 150, 150))).toBe('a')
      expect(place.dropTarget()).toEqual({ id: 'a', frameId: square.id })
      expect(place.imageTarget(stage(square, 160, 160))).toBe('a')
      expect(log).toEqual(['overlay'])
      expect(place.imageTarget(stage(square, 380, 780))).toBe('box')
      expect(place.imageTarget(null)).toBeNull()
      expect(place.dropTarget()).toBeNull()
      expect(log).toEqual(['overlay', 'overlay', 'overlay'])
    })

    it('finds none over text, a line, a layer whose style is locked or empty space', () => {
      const { place, square, stage } = harness()
      expect(place.imageTarget(stage(square, 750, 110))).toBeNull()
      expect(place.imageTarget(stage(square, 550, 150))).toBeNull()
      expect(place.imageTarget(stage(square, 350, 150))).toBeNull()
      expect(place.imageTarget(stage(square, 900, 900))).toBeNull()
    })
  })

  describe('placeImage', () => {
    it('places an image centred on a stage point, selected, with the select tool back', () => {
      const { place, session, selection, square, boxOf, stage } = harness()
      const id = place.placeImage(PHOTO, stage(square, 500, 500))
      expect(session.design().nodes[id ?? '']?.props).toMatchObject({
        fills: [{ type: 'image', assetId: 'photo', fit: 'fill' }],
      })
      expect(boxOf(id ?? '')).toEqual({ x: 300, y: 400, width: 400, height: 200 })
      expect(selection.current()).toEqual(pairsIn(square.id, [id ?? '']))
    })

    it('places the brand’s logo as a logo whose picture follows the brand, in one undo step', () => {
      const { place, session, square, stage } = harness()
      const id = place.placeImage(PHOTO, stage(square, 500, 500), { logo: { name: 'Logo' } }) ?? ''
      expect(session.design().nodes[id]).toMatchObject({
        name: 'Logo',
        role: 'logo',
        bindings: { image: 'brand:logo' },
        props: { fills: [{ type: 'image', assetId: 'photo' }] },
      })
      session.undo()
      expect(session.design().nodes[id]).toBeUndefined()
      expect(session.canUndo()).toBe(false)
    })

    it('places nothing off every frame, and in the middle of the frame in view with no point', () => {
      const { place, selection, wide } = harness()
      expect(place.placeImage(PHOTO, { x: -500, y: -500 })).toBeNull()
      const id = place.placeImage(PHOTO)
      expect(selection.current()).toEqual(pairsIn(wide.id, [id ?? '']))
    })

    it('with no point, goes in the picked frame, not the one in the middle of the view', () => {
      const { place, selection, square } = harness()
      selection.pickFrame(square.id)
      const id = place.placeImage(PHOTO)
      expect(selection.current()).toEqual(pairsIn(square.id, [id ?? '']))
    })

    it('with no point, goes in the frame of the layer selected, off the middle of the view', () => {
      const { place, selection, square } = harness()
      selection.select(['a'], square.id)
      const id = place.placeImage(PHOTO)
      expect(selection.current()).toEqual(pairsIn(square.id, [id ?? '']))
    })
  })

  describe('fillWithImage', () => {
    it("puts the image on top of the layer's fills, as one undo step, selected in its frame; its copy keeps its own", () => {
      const { place, session, selection, wide, fillsOf, stage } = harness()
      expect(place.imageTarget(stage(wide, 150, 150))).toBe('wide-a')
      expect(place.fillWithImage('wide-a', PHOTO)).toBe(true)
      const image = { type: 'image', assetId: 'photo', fit: 'fill', opacity: 1 }
      expect(fillsOf('wide-a')).toEqual([BLUE, image])
      expect(fillsOf('a')).toEqual([RED])
      expect(selection.current()).toEqual(pairsIn(wide.id, ['wide-a']))
      expect(place.dropTarget()).toBeNull()
      session.undo()
      expect(fillsOf('wide-a')).toEqual([BLUE])
    })

    it('can’t fill a layer whose style is locked', () => {
      const { place, session } = harness()
      expect(place.fillWithImage('styled', PHOTO)).toBe(false)
      expect(session.canUndo()).toBe(false)
    })

    it('selects the layer in its own frame when it was dropped nowhere', () => {
      const { place, selection, square } = harness()
      place.fillWithImage('inside', PHOTO)
      expect(selection.current()).toEqual(pairsIn(square.id, ['inside']))
    })
  })
})
