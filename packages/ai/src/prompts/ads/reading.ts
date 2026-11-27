// The reading's prompt: what each text block of an ad says, its spelling slips fixed, and how it is lettered.
// The words come from the reference flow's ad prompts, and only the words were taken.

/** The version of the reading. */
export const READING_PROMPT_VERSION = 'v1'

/** The reading: the instructions of the call that reads the text blocks. */
export const READING_PROMPT = `You read the text of an ad so it can be re-typeset as editable text.

You get a sheet with one crop of the ad per text block, labelled with its id; the text a first reading
found for each block is listed after it. The ads are often AI-generated, so their lettering can contain spelling
mistakes, garbled or doubled letters and missing or extra spaces that the advertiser never intended.
For every block:
1. text: the text the advertiser intended, correctly spelled. Read it from the crop, then fix spelling mistakes,
   garbled letters and wrong spacing. Keep brand and product names, codes, prices, numbers and deliberate
   stylisations (for example a playful spelling or an all-caps word) as they are; when unsure, keep what the crop
   shows. Keep the crop's capitals and punctuation; put a line break (\\n) where the crop breaks the line. If the
   crop also shows other text around the block, read only the block's own text (the one matching the first reading).
2. corrections: what you changed from what the crop literally shows (e.g. "canculling -> cancelling"), or empty.
3. lettering: "font" when it looks set in a regular typeface; "custom" when it is hand-drawn, decorative or
   distorted lettering (arched, warped, textured, illustrated) that no regular font would reproduce.
4. style: the lettering's kind: "sans-serif", "serif", "slab-serif", "script" (handwriting, brush script),
   "display" (decorative designs: stencil, brush, retro, inline or outline-only shapes; a plain bold or condensed
   headline face is sans-serif or serif), or "monospace"; italic: true when the letters slant; rounded: true when
   the stroke ends and corners are rounded off (soft, like Nunito or Fredoka), false when they are cut square.
5. mixed_styles: true when part of the block is in a clearly different size, weight, colour or typeface from the
   rest (for example a bold code inside a sentence, or a small currency sign next to a big price); describe it in
   mixed_note. Otherwise false and an empty note.
`
