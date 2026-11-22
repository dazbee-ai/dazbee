import { describe, expect, it } from 'vitest'

import { loadFontFiles } from '@dazbee/fonts/node'
import { loadCanvasKit } from '@dazbee/renderer/node'
import type { MatchAnswer, MatchKit, UnplacedLayer } from '@dazbee/schema'

import { ciede2000, srgbToLab } from '../looks-same/colour.ts'
import { hexRgb } from '../shape/parts/colour.ts'
import type { FontSource } from './font-source.ts'
import { matchText, type TextMatcherDeps } from './match-text.ts'
import { textMatcherFiles } from './test-text-files.ts'
import { drawText, lightDrawings, lightFonts, type LightPiece, lightPieces, textJob } from './test-text-pieces.ts'

const ck = await loadCanvasKit()
const { files, model } = await textMatcherFiles()
const fonts = lightFonts()
const pieces = lightPieces(ck, fonts)

/** A brand's uploaded font: a shipped face, which no other key gives, under a family no fingerprint knows. */
const UPLOAD = {
  family: 'Brand Grotesk',
  weight: 800,
  bytes: loadFontFiles().find((face) => face.file === 'NotoSans-ExtraBold.ttf')?.bytes ?? new Uint8Array(),
}
/** The faces of Light's test, and the upload under its family; none for any other key. */
const FIXTURE_FONTS: FontSource = {
  face: async (key) => (key === `${UPLOAD.family}|${UPLOAD.weight}|normal` ? UPLOAD.bytes : (fonts.get(key) ?? null)),
}
const DEPS: TextMatcherDeps = {
  ck,
  files,
  model,
  fonts: FIXTURE_FONTS,
  kitFaces: [{ family: UPLOAD.family, weight: UPLOAD.weight, style: 'normal' }],
}
const NO_KIT: MatchKit = { colors: {}, fonts: {}, textStyles: [] }
/** The colour the tilted piece of Light's test is drawn in, and one ΔE00 12 from it. */
const TILTED_COLOUR = '#C2185BFF'
const NEAR_MISS = '#C2188FFF'

/** A piece of Light's test matched twice with a kit, which must give the same answer. */
async function matchTwice(piece: Pick<LightPiece, 'pixels' | 'words'>, kit: Partial<MatchKit>): Promise<MatchAnswer> {
  const { job, piece: jobPiece } = textJob(ck, piece.pixels, piece.words, { kit: { ...NO_KIT, ...kit } })
  const first = await matchText(job, jobPiece, DEPS)
  expect(await matchText(job, jobPiece, DEPS)).toEqual(first)
  return first
}

/** The piece of Light's test with this id. */
function pieceOf(id: string): LightPiece {
  const piece = pieces.find((p) => p.id === id)
  if (!piece) throw new Error(`Light's test has no piece ${id}`)
  return piece
}

/** The one text layer of an answer that looks the same. */
function textLayerOf(answer: MatchAnswer): Extract<UnplacedLayer, { type: 'text' }> {
  expect(answer.kind).toBe('layers')
  const layer = answer.kind === 'layers' ? answer.layers[0] : undefined
  if (layer?.type !== 'text') throw new Error('the answer is no text layer')
  return layer
}

describe('pickFit', () => {
  it('gives text drawn in the kit’s Heading font back in it, bound to brand:heading', async () => {
    const layer = textLayerOf(await matchTwice(pieceOf('latin-plain'), { fonts: { heading: 'Montserrat' } }))
    expect(layer.props.style).toMatchObject({ fontFamily: 'Montserrat', fontWeight: 800 })
    expect(layer.bindings).toEqual({ fontFamily: 'brand:heading' })
  })

  it('gives text drawn in a brand’s uploaded font, which has no fingerprint, back in it', async () => {
    const drawing = lightDrawings().find((d) => d.id === 'latin-outlined')
    if (!drawing) throw new Error('Light’s test has no outlined piece')
    const pixels = drawText(ck, { ...drawing, family: UPLOAD.family, weight: UPLOAD.weight }, [UPLOAD])
    const answer = await matchTwice({ pixels, words: drawing.words }, { fonts: { heading: UPLOAD.family } })
    const layer = textLayerOf(answer)
    expect(layer.props.style).toMatchObject({ fontFamily: UPLOAD.family, fontWeight: UPLOAD.weight })
    expect(layer.bindings).toEqual({ fontFamily: 'brand:heading' })
  })

  it('binds nothing with no kit', async () => {
    expect(textLayerOf(await matchTwice(pieceOf('latin-plain'), {})).bindings).toBeUndefined()
  })
})

describe('kitColoured', () => {
  it('gives text drawn in a kit colour back in it, bound to its token', async () => {
    const layer = textLayerOf(await matchTwice(pieceOf('latin-tilted'), { colors: { accent: TILTED_COLOUR } }))
    expect(layer.props.style.color).toBe(TILTED_COLOUR)
    expect(layer.bindings).toEqual({ textColor: 'brand:accent' })
  })

  it('leaves text drawn ΔE00 12 from a kit colour in its own colour, unbound', async () => {
    expect(ciede2000(srgbToLab(...hexRgb(TILTED_COLOUR)), srgbToLab(...hexRgb(NEAR_MISS)))).toBeCloseTo(12, 1)
    const layer = textLayerOf(await matchTwice(pieceOf('latin-tilted'), { colors: { accent: NEAR_MISS } }))
    expect(layer.props.style.color).not.toBe(NEAR_MISS)
    expect(layer.bindings).toBeUndefined()
  })
})

describe('kitStyle', () => {
  it('sets text in the kit text style it matches, bound to it in place of its font', async () => {
    const layer = textLayerOf(
      await matchTwice(pieceOf('latin-tight'), {
        fonts: { heading: 'Montserrat' },
        textStyles: [
          {
            token: 'headline',
            name: 'Headline',
            font: { token: 'heading' },
            fontWeight: 800,
            fontStyle: 'normal',
            letterSpacing: { unit: 'percent', value: -5 },
          },
        ],
      }),
    )
    expect(layer.bindings).toEqual({ textStyle: 'brand:headline' })
    expect(layer.props.style).toMatchObject({
      fontFamily: 'Montserrat',
      fontWeight: 800,
      letterSpacing: { unit: 'percent', value: -5 },
    })
    // The style leaves the line height to the font.
    expect(layer.props.style.lineHeight).toBeUndefined()
  })
})
