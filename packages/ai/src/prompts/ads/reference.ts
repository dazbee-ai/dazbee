// The reference ad's prompts: reading which kind of ad a reference is, and what the round planner is told in place
// of the four kinds when a round is to be of the reference's kind.
// The words come from the reference flow's ad prompts, and only the words were taken.

/** The version of the reference reader. */
export const REFERENCE_READER_VERSION = 'v1'

/** The reference reader: the instructions of the call that says whether a reference is an ad, and its kind. */
export const REFERENCE_READER = `You read one picture that an advertiser gives as a reference: an ad of the kind they want their own ads
to be. You say whether it is an ad, and which of four kinds of ad it is.

# An ad

An ad is one finished static advertising picture: a design made to sell or announce something, with at least a
headline or a brand on it, and usually a product, an offer or a button. These are no ad: a photograph or an
illustration with no text on it, a screenshot of an app, a feed or a web page, a frame of a video, a document, a sheet
of several ads side by side. For a picture that is no ad, still name the kind it comes closest to.

# The four kinds

Decide in this order, and take the first kind that fits:
1. free: one strong photograph paired with rich, carefully built information, the way a premium brand sets an ad
   that has more to say than a headline: three or more features or benefits listed side by side or one under
   another, each with a small line icon or a short title of its own. The information lies on the photograph (often
   on a card floating on it) or beside it. A headline, a line under it, a price or offer badge and a button are not
   rich information: most ads have those, and an ad with only those is of another kind.
2. graphical: no photographed setting anywhere. The ad is built from design: colour, shapes, drawing and lettering,
   with the subject as an illustration or a cut-out photo. A product, a person or a hand that floats on a plain
   colour, a gradient or painted shapes, with no surface or setting around it, is a cut-out, even when it was
   photographed. Silhouettes, light rays, glows, paint strokes and splashes on a colour ground are design too, not a
   photographed setting.
3. photographic: one real photograph of a real setting fills the whole canvas: a room, a landscape, a street, or a
   styled set where objects stand on a surface (a table, a plinth, a slab of stone) under the same light, even when
   the wall behind them is one plain colour. The texts, small icons and the button lie straight on the photograph,
   a text on the set's plain wall too.
4. composite: photography and graphic design carry the ad together: a photograph that does not fill the canvas (a
   photograph beside a flat panel of colour, or inside a frame or a shape), or a photograph of a real setting with
   bold shapes, fields of colour, panels, bands or drawing laid on it or cutting into it.

A small badge, sticker or button on a photograph does not make it composite: only shapes, panels, bands or fields of
colour that cover a real part of the photograph do.

# The answer

why: in one sentence, what fills the canvas and what the texts sit on, which decide whether the picture is an ad and
its kind.
`

/** The version of the reference-ad words. */
export const REFERENCE_AD_VERSION = 'v1'

/**
 * Told to the round planner, with the reference as the first picture. `{kind}` is `REFERENCE_KIND` with the kind's
 * name, or `REFERENCE_KIND_UNKNOWN` when no kind was read. The draft calls never get the reference.
 */
export const REFERENCE_AD = `The first attached picture is a reference ad: an ad the advertiser gives for its kind and its look, made for
another product and often for another brand. In this round the four kinds do not apply. {kind} When the kind is free,
each of the four carries all that the fourth ad carries and keeps to its rules, with at most twelve texts, and the
four take four different types: the first the reference's own type, the other three each another.

Take from the reference only its kind and its look: what fills the canvas, how the picture and the texts share it, how
much there is to read and how it is set out, the kind of lettering and the mood. Nothing else of it is in any of the
four ads: not its brand or its logo, not one of its words, prices, offers or claims, not its product, its people or
its colours, and none of its artwork. The ads are made, as always, from the advertiser's words, their pictures and
the brand's own colours.
- The first ad follows the reference's arrangement: the picture, the texts and the button in the same places, each
  taking the same share of the canvas, fitted to this product, these texts and this canvas.
- The other three keep the reference's kind and look, and each is arranged in another way of its own, with another
  view of the subject, another background and another of the brand's colours leading.
Nobody should take one of the four for the reference, or two of them for the same ad.`

/** The kind line of `REFERENCE_AD` for a known kind; `{kind}` is its name. */
export const REFERENCE_KIND = `Every ad is {kind}, as that kind is described above, and names it as its kind.`

/** The kind line of `REFERENCE_AD` when no kind was read. */
export const REFERENCE_KIND_UNKNOWN = `Every ad is of the reference's kind: decide first which of the four kinds described above it is, and every ad names it as its kind.`
