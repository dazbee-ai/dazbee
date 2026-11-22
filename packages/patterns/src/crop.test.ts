import { describe, expect, it } from 'vitest'

import { coverCrop, fitCrop } from './crop.ts'

/** A wide photo, its subject a wide band low in it, as a product shot on a backdrop is. */
const PHOTO = {
  assetId: 'photo',
  width: 1920,
  height: 1200,
  look: { subject: { x: 400, y: 530, width: 1160, height: 430 }, inks: [] },
}

describe('coverCrop', () => {
  it('shows the whole subject with room round it where the box can hold it, and covers the box', () => {
    const box = { x: 0, y: 0, width: 1080, height: 600 }
    const { crop, subject, whole } = coverCrop(PHOTO, box)
    expect(whole).toBe(true)
    // The box is covered: the crop stays inside the photo.
    expect(crop.x).toBeGreaterThanOrEqual(0)
    expect(crop.y).toBeGreaterThanOrEqual(0)
    expect(crop.x + crop.width).toBeLessThanOrEqual(1920.01)
    expect(crop.y + crop.height).toBeLessThanOrEqual(1200.01)
    expect(subject.x).toBeGreaterThan(0)
    expect(subject.x + subject.width).toBeLessThan(1080)
  })

  it('tells where a box can’t hold the whole subject, as a narrow half of a square can’t a wide shoe', () => {
    expect(coverCrop(PHOTO, { x: 0, y: 0, width: 540, height: 1080 }).whole).toBe(false)
  })

  it('keeps the subject inside the part of the box nothing is drawn over', () => {
    const box = { x: 0, y: 0, width: 1080, height: 700 }
    const keep = { x: 0, y: 200, width: 1080, height: 500 }
    const { subject, whole } = coverCrop(PHOTO, box, keep)
    expect(whole).toBe(true)
    expect(subject.y).toBeGreaterThanOrEqual(199)
  })
})

describe('fitCrop', () => {
  it('fits a cut-out by its subject, not the clear round it', () => {
    const cutOut = { ...PHOTO, look: { ...PHOTO.look, subject: { x: 100, y: 100, width: 1000, height: 400 } } }
    const { box } = fitCrop(cutOut, { x: 0, y: 0, width: 520, height: 520 })
    expect(box.width).toBeCloseTo(520)
    expect(box.height).toBeLessThan(220)
  })
})
