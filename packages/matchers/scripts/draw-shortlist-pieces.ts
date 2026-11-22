// Draws the text shortlist test's pieces again with Dazbee's renderer, each in its Google face from a
// checkout of google/fonts at `GOOGLE_FONTS`'s commit, as `fixtures/text-shortlist/pieces.json`
// describes them, into a PNG a piece beside it:
//   node scripts/draw-shortlist-pieces.ts <google/fonts checkout>
// The test's count of drawn faces found holds for these pixels only, so a piece drawn again needs
// the prototype's count taken again on it.

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { loadCanvasKit } from '@dazbee/renderer/node'

import { parseFontKey } from '../src/text/font-key.ts'
import { drawText, SHORTLIST_FIXTURES, type ShortlistDrawing } from '../src/text/test-text-pieces.ts'

const [checkout] = process.argv.slice(2)
if (!checkout) {
  console.error('Usage: node scripts/draw-shortlist-pieces.ts <google/fonts checkout>')
  process.exit(1)
}
const ck = await loadCanvasKit()
const { pieces } = JSON.parse(readFileSync(join(SHORTLIST_FIXTURES, 'pieces.json'), 'utf8')) as {
  pieces: ShortlistDrawing[]
}
for (const { id, key, file, ...text } of pieces) {
  const face = parseFontKey(key)
  if (!face) throw new Error(`${key} of ${id} is not a font key`)
  const { width, height, pixels } = drawText(ck, { ...text, ...face }, [
    { family: face.family, bytes: new Uint8Array(readFileSync(join(checkout, file))) },
  ])
  const image = ck.MakeImage(
    {
      width,
      height,
      colorType: ck.ColorType.RGBA_8888,
      alphaType: ck.AlphaType.Unpremul,
      colorSpace: ck.ColorSpace.SRGB,
    },
    pixels,
    width * 4,
  )
  const png = image?.encodeToBytes()
  image?.delete()
  if (!png) throw new Error(`CanvasKit couldn't encode ${id}`)
  writeFileSync(join(SHORTLIST_FIXTURES, `${id}.png`), png)
  console.log(`${id}: ${width} × ${height}`)
}
