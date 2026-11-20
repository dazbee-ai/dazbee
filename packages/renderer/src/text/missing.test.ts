// The characters no font draws in a laid-out text, as whole graphemes: what the export check lists.
import { describe, expect, it } from 'vitest'

import { EMOJI_FAMILY, FALLBACK_FAMILIES } from '@dazbee/fonts'
import { loadFontFiles } from '@dazbee/fonts/node'
import { emojiTestFont } from '@dazbee/fonts/test-fonts'
import { TextProps } from '@dazbee/schema'

import { loadCanvasKit } from '../node.ts'
import { resourceCache } from '../resources.ts'
import { layoutText } from './layout.ts'
import { missingGraphemes } from './missing.ts'

const ck = await loadCanvasKit()
// A cache each: a cache lets go of its fonts when given others.
const shipped = resourceCache(ck).resources({
  fonts: loadFontFiles(),
  fallbackFamilies: [...FALLBACK_FAMILIES],
  images: {},
})
const withEmoji = resourceCache(ck).resources({
  fonts: [...loadFontFiles(), { family: EMOJI_FAMILY, bytes: emojiTestFont() }],
  fallbackFamilies: [...FALLBACK_FAMILIES],
  images: {},
})

/** The graphemes no font draws in `text`, laid out in a box `width` wide. */
function missing(
  text: string,
  {
    emoji = false,
    family = 'Noto Sans',
    maxLines,
    outline = false,
    width = 600,
    wrapStyle = 'auto',
  }: {
    emoji?: boolean
    family?: string
    maxLines?: number
    outline?: boolean
    width?: number
    wrapStyle?: TextProps['wrapStyle']
  } = {},
) {
  const props = TextProps.parse({
    x: 0,
    y: 0,
    width,
    height: 40,
    text,
    wrapStyle,
    ...(maxLines ? { maxLines } : {}),
    style: {
      fontFamily: family,
      fontSize: 20,
      color: '#000000FF',
      ...(outline ? { outline: { width: 2, color: '#FF0000FF' } } : {}),
    },
  })
  const laid = layoutText(ck, props, emoji ? withEmoji : shipped)
  const found = laid.blocks.flatMap((block) => missingGraphemes(block))
  laid.delete()
  return found
}

describe('missingGraphemes', () => {
  it('names each grapheme no font has, once, and nothing for text every font draws', () => {
    expect(missing('Runes ᚠ ᚠ and a clef 𝄞')).toEqual(['ᚠ', '𝄞'])
    expect(missing('Fresh roast, नमस्ते, مرحبا')).toEqual([])
  })

  it('takes an emoji sequence whole without the emoji font, and a plain digit beside a keycap is drawn', () => {
    const family = '\u{1F468}‍\u{1F469}‍\u{1F467}'
    expect(missing(`Hi 1 1️⃣ \u{1F600} ${family}`)).toEqual(['1️⃣', '\u{1F600}', family])
    expect(missing(`Hi 1 1️⃣ \u{1F600}`, { emoji: true })).toEqual([])
  })

  it('names nothing for a family that falls back, nor for characters cut off by a line limit', () => {
    expect(missing('Wrong family', { family: 'Nope Sans' })).toEqual([])
    expect(missing('aaaa bbbb cccc dddd ᚠᚠ', { maxLines: 1, width: 80 })).toEqual([])
  })

  it('counts outlined text once, and each paragraph of the text', () => {
    expect(missing('ᚠ', { outline: true })).toEqual(['ᚠ'])
    expect(missing('ᚠ\n𝄞')).toEqual(['ᚠ', '𝄞'])
  })

  it('names a character on the line after one Pretty ends early', () => {
    // Pretty ends the first line before dddd, so the Syriac letter is not alone on the last.
    expect(missing('aaaa bbbb cccc dddd ܐ', { width: 200, wrapStyle: 'pretty' })).toEqual(['ܐ'])
  })
})
