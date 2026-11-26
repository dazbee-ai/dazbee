// The draft's prompts: the plain prompt a draft falls back on when the plan gave it none, and the sentence about the
// advertiser's pictures the picture model is told whenever the brief has pictures.
// The words come from the reference flow's ad prompts, and only the words were taken, with their version names.

/** The version of the plain draft prompt. */
export const DRAFT_PROMPT_VERSION = 'v1'

/**
 * The plain draft prompt. `{shape}` is the picture's shape in words, `{brief}` the brief's words, and `{pictures}`
 * `PICTURES_SENTENCE` as a list item ending in a line break, or nothing.
 */
export const DRAFT_PROMPT = `Make one complete, finished advertisement, ready to publish, as a {shape} image.

What the advertiser asks for:
{brief}

How to make it:
- One clear headline, a short supporting line and a call to action. Spell every word correctly, and keep all text
  large enough to read easily.
- A clean layout with distinct elements: the main picture, each text, the button, the logo if there is one. Keep
  them apart from each other: no text over a busy area, and nothing overlapping a text.
{pictures}- Fill the whole image with the ad. No frame around it, no mock-up, no device and no hands holding it.
- Use what the advertiser asked for. Do not invent a brand name, a price, an offer or a claim they did not give.
`

/** Told to the picture model, whichever prompt it gets, when the brief has pictures. */
export const PICTURES_SENTENCE = `The attached pictures are the advertiser's own: a product, a logo. Show each of them in the ad as it is: the same product, the same logo, the same colours. Do not redraw or restyle them.`
