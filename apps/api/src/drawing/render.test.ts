// What drawing a design needs from the brand, against Postgres and storage from Docker Compose
// (`docker compose up -d --wait`).
import { describe, expect, it } from 'vitest'

import { brands, newId } from '@dazbee/db'
import { parseDesign } from '@dazbee/schema'

import { replaceFace } from '../fonts/fonts.ts'
import { uploadedFontKey } from '../storage-keys.ts'
import { brand, call, db, run, sibling, storage, uploadImage, workspace } from '../test-api.ts'
import { fontFile, png, sha256 } from '../test-files.ts'
import { brandResourcesFor, renderCover } from './render.ts'
import { uploadHugeFamily } from './test-huge-family.ts'

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

/** A design whose one frame holds a line of words in `family`. */
function wordsIn(family: string) {
  const parsed = parseDesign({
    meta: { designId: 'd', name: 'Words' },
    pages: { p1: { name: 'Page 1', order: 'a0' } },
    frames: { sq: { pageId: 'p1', name: 'Square', width: 300, height: 80, x: 0, y: 0, order: 'a0' } },
    nodes: {
      t: {
        type: 'text',
        parentId: 'sq',
        link: 't',
        index: 'a0',
        name: 'Words',
        props: {
          ...{ x: 10, y: 10, width: 280, height: 60, text: 'Big sale' },
          style: { fontFamily: family, fontSize: 40, color: '#000000FF' },
        },
      },
    },
  })
  if (!parsed.success) throw new Error(parsed.errors.join('\n'))
  return parsed.design
}

/** Makes a brand of workspace A with no uploads, which no other test uses. */
async function addBrand() {
  const added = { id: `brand-fonts-${newId()}`, workspaceId: workspace.id, name: 'Brand Fonts' }
  await db.insert(brands).values(added)
  return added
}

/** Stores `bytes` as the brand's upload of `family`, upright 400, whatever name the file gives itself. */
async function uploadAs(brandId: string, family: string, bytes: Uint8Array) {
  const hash = sha256(bytes)
  await storage.put(uploadedFontKey(workspace.id, hash), bytes, 'font/ttf')
  await replaceFace(db, {
    ...{ id: newId(), workspaceId: workspace.id, brandId, source: 'upload', family },
    ...{ weight: 400, weightMin: null, weightMax: null, style: 'normal', category: null },
    ...{ sha256: hash, byteSize: bytes.length },
  })
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

  it('reads only the faces its texts are drawn in, of a family of six', async () => {
    const family = `Faces ${run}`
    const keys = await uploadHugeFamily(storage, workspace.id, brand.id, family, 0)
    const parsed = parseDesign({
      meta: { designId: 'd', name: 'Faces' },
      pages: { p1: { name: 'Page 1', order: 'a0' } },
      frames: { sq: { pageId: 'p1', name: 'Square', width: 100, height: 100, x: 0, y: 0, order: 'a0' } },
      nodes: {
        t: {
          type: 'text',
          parentId: 'sq',
          link: 't',
          index: 'a0',
          name: 'Words',
          props: {
            ...{ x: 0, y: 0, width: 100, height: 40, text: 'Big sale' },
            style: { fontFamily: family, fontSize: 20, color: '#000000FF' },
            runs: [{ start: 0, end: 3, style: { fontWeight: 700 } }],
          },
        },
      },
    })
    if (!parsed.success) throw new Error(parsed.errors.join('\n'))
    const resources = await brandResourcesFor(db, storage, workspace.id, brand.id, parsed.design)
    const read = resources.fonts.map((font) => uploadedFontKey(workspace.id, sha256(font.bytes)))
    expect(read).toEqual([keys.get('400 normal'), keys.get('700 normal')])
  })

  it("draws a brand's upload of a shipped family's name in place of the shipped file, and ours for a brand without one", async () => {
    const [own, other] = await Promise.all([addBrand(), addBrand()])
    // A file of other letters under the name of a font we ship, and the same file under a name of its own.
    const upload = fontFile('NotoSans-Bold.ttf')
    await uploadAs(own.id, 'Noto Naskh Arabic', upload)
    await uploadAs(other.id, `Own Sans ${run}`, upload)
    const drawn = async (brandId: string, family: string) =>
      Buffer.from((await renderCover(db, storage, workspace.id, brandId, wordsIn(family))).pixels)
    const uploaded = await drawn(own.id, 'Noto Naskh Arabic')
    expect(uploaded.equals(await drawn(other.id, `Own Sans ${run}`))).toBe(true)
    expect(uploaded.equals(await drawn(other.id, 'Noto Naskh Arabic'))).toBe(false)
  })
})
