// What apply_pattern tells an agent of a pattern's build: a first draft to adapt to the brief, never the finished ad,
// and two or three ways to make it the brand's own, chosen from what the pattern and the brand kit hold, so ads built
// from one pattern don't all look alike.
import { type Pattern, type PatternContent, type PatternStyle, STYLE_FONTS } from '@dazbee/patterns'
import type { BrandKit } from '@dazbee/schema'

/** What an agent is told of a pattern's build. */
export const STARTING_POINT =
  'A first draft from a pattern, not the finished ad: adapt it to the brief and make it this brand’s own before you finish, changing at least one of the suggestions below or something better, then render_frame and check_frame each frame.'

/** The most ways suggested. */
const MOST = 3
/** The graphic that says each kind of ad, as search_graphics finds it. */
const GRAPHIC_FOR: Readonly<Record<string, string>> = {
  'sale or offer': 'a tag or a percent sign',
  event: 'a calendar or a map pin',
  'app download': 'a phone or a download arrow',
  'product launch': 'a sparkle or a star',
  'single product': 'a check mark beside a feature',
  'lifestyle photo': 'a small icon of what the photo shows',
}

/**
 * Two or three concrete ways to make a pattern's build the brand's own, chosen from what the pattern and the brand
 * kit hold: a face with character where the kit sets none, the photo's crop or focal point where there is a photo
 * (a cut-out's size or angle), a brand graphic or icon that says the brief, and a treatment of the headline.
 */
export function patternSuggestions(
  pattern: Pattern,
  style: PatternStyle,
  kit: BrandKit,
  content: Partial<PatternContent>,
): string[] {
  const ways: string[] = []
  const heading = kit.fonts.find((font) => font.token === 'heading')
  if (!heading)
    ways.push(
      `Choose a heading face for this brand: the kit sets none, so the ${style} style’s ${STYLE_FONTS[style].heading} is used. list_fonts finds one with character; set the kit’s Heading role, or bind the headline’s fontFamily with node.bind.`,
    )
  const takesPhoto = pattern.needs.includes('photo') || pattern.takes.includes('photo')
  if (takesPhoto && content.photo?.look?.extent)
    ways.push(
      'Give the product more presence: set it larger, so it breaks out of what it stands on, or at an angle (node.update), or try another cut-out of it from list_assets.',
    )
  else if (takesPhoto && content.photo)
    ways.push(
      'Move the photo’s focal point: change the crop of its image fill (node.update) so the subject sits closer or off-centre, or try another of the brand’s photos (list_assets) or a stock photo (search_stock).',
    )
  else if (takesPhoto)
    ways.push(
      'Add a photo: this pattern takes one, and an ad with a real picture reads faster. list_assets, search_stock and add_image find one; build again with it.',
    )
  const graphic = pattern.kinds.map((kind) => GRAPHIC_FOR[kind]).find(Boolean) ?? 'an icon that says the brief'
  ways.push(
    `Add a brand graphic or icon that carries the brief, such as ${graphic}: search_graphics finds one, and place_graphic sets it in a brand colour near the headline, clear of the words.`,
  )
  if (pattern.takes.includes('highlight') && !content.highlight)
    ways.push(
      'Set one or two words of the headline apart: build again with content.highlight, or give the words their own colour or weight.',
    )
  else
    ways.push(
      'Give the headline a treatment of its own: another line break, case or size step that suits the brief (text.edit, node.update), or a second colour from the kit on its key words.',
    )
  return ways.slice(0, MOST)
}
