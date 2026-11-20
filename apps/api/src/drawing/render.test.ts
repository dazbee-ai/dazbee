// What drawing a design needs from the brand, against Postgres and storage from Docker Compose
// (`docker compose up -d --wait`).
import { describe, expect, it } from 'vitest'

import { parseDesign } from '@dazbee/schema'

import { brand, call, db, run, sibling, storage, uploadImage, workspace } from '../test-api.ts'
import { png } from '../test-files.ts'
import { brandResourcesFor } from './render.ts'

/** A design whose one graphic draws `assetId`, its picture bound to the brand's logo. */
function logoDesign(assetId: string) {
  const parsed = parseDesign({
    meta: { designId: 'd', name: 'Logo' },
    pages: { p1: { name: 'Page 1', order: 'a0' } },
    frames: { sq: { pageId: 'p1', name: 'Square', width: 100, height: 100, x: 0, y: 0, order: 'a0' } },
    nodes: {
      logo: {
        type: 'graphic',
        parentId: 'sq',
        link: 'logo',
        index: 'a0',
        name: 'Logo',
        role: 'logo',
        bindings: { image: 'brand:logo' },
        props: {
          ...{ x: 0, y: 0, width: 40, height: 40, shape: { kind: 'rect' } },
          fills: [{ type: 'image', assetId, fit: 'fit' }],
        },
      },
    },
  })
  if (!parsed.success) throw new Error(parsed.errors.join('\n'))
  return parsed.design
}

const EMPTY_KIT = { colors: [], fonts: [], voice: '' }
const SVG = new TextEncoder().encode(
  `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><!-- ${run} --><rect width="10" height="10"/></svg>`,
)

// Recording a logo makes its thumbnail with CanvasKit, which takes seconds to load on a busy CI runner.
describe('brandResourcesFor', { timeout: 30_000 }, () => {
  it("loads the kit's logo for a picture bound to it, in place of the one the design stores", async () => {
    const { asset: stored } = await uploadImage('a', brand.id, png(12, 12, `${run}-stored`))
    const { asset: logo } = await uploadImage('a', brand.id, png(16, 8, `${run}-kit-logo`))
    await call('a', 'PUT', `/brands/${brand.id}/kit`, { ...EMPTY_KIT, logoAssetId: logo.id })
    const resources = await brandResourcesFor(db, storage, workspace.id, brand.id, logoDesign(stored.id))
    expect(resources.variables).toEqual({ 'brand:logo': logo.id })
    expect(Object.keys(resources.images)).toEqual([logo.id])
  })

  it('draws the picture the design stores when the kit’s logo is an SVG file', async () => {
    const { asset: stored } = await uploadImage('a', sibling.id, png(12, 12, `${run}-stored-svg`))
    const { asset: logo } = await uploadImage('a', sibling.id, SVG, 'Logo', 'image/svg+xml')
    await call('a', 'PUT', `/brands/${sibling.id}/kit`, { ...EMPTY_KIT, logoAssetId: logo.id })
    const resources = await brandResourcesFor(db, storage, workspace.id, sibling.id, logoDesign(stored.id))
    expect(resources.variables).toEqual({})
    expect(Object.keys(resources.images)).toEqual([stored.id])
  })
})
