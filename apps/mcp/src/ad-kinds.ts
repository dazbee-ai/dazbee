// The kinds of ad the ad rules advise on: what each leads with, and font pairings that suit it, each family in a
// weight Google Fonts has it in. Dazbee's own advice.

/** The kinds of ad the ad rules advise on. */
export const AD_KINDS = [
  'sale',
  'launch',
  'product',
  'lifestyle',
  'quote',
  'event',
  'app',
  'before-after',
  'comparison',
  'benefits',
  'big-number',
  'words-only',
] as const
export type AdKind = (typeof AD_KINDS)[number]
/** A font a pairing names, in a weight Google Fonts has it in. */
export interface PairedFont {
  family: string
  weight: number
}

/** Two fonts that work together, and the ads they suit. */
export interface FontPairing {
  heading: PairedFont
  body: PairedFont
  suits: string
}

const ANTON_INTER: FontPairing = {
  heading: { family: 'Anton', weight: 400 },
  body: { family: 'Inter', weight: 500 },
  suits: 'loud offers and prices: a tall, heavy display face over a plain sans',
}
const ARCHIVO: FontPairing = {
  heading: { family: 'Archivo Black', weight: 400 },
  body: { family: 'Archivo', weight: 400 },
  suits: 'big numbers and bold claims: a black display face over its own family’s regular',
}
const SPACE_GROTESK_INTER: FontPairing = {
  heading: { family: 'Space Grotesk', weight: 700 },
  body: { family: 'Inter', weight: 400 },
  suits: 'tech, apps and launches: a modern grotesque with character over a plain sans',
}
const POPPINS: FontPairing = {
  heading: { family: 'Poppins', weight: 700 },
  body: { family: 'Poppins', weight: 400 },
  suits: 'friendly and clear: one geometric sans in two weights',
}
const PLAYFAIR_LATO: FontPairing = {
  heading: { family: 'Playfair Display', weight: 700 },
  body: { family: 'Lato', weight: 400 },
  suits: 'premium, beauty and lifestyle: a high-contrast serif over a warm sans',
}
const DM_SERIF_SANS: FontPairing = {
  heading: { family: 'DM Serif Display', weight: 400 },
  body: { family: 'DM Sans', weight: 400 },
  suits: 'quotes and editorial lines: a display serif over its matching sans',
}
const FREDOKA_NUNITO: FontPairing = {
  heading: { family: 'Fredoka', weight: 600 },
  body: { family: 'Nunito', weight: 400 },
  suits: 'playful, kids and food: rounded letters',
}
const BEBAS_MONTSERRAT: FontPairing = {
  heading: { family: 'Bebas Neue', weight: 400 },
  body: { family: 'Montserrat', weight: 500 },
  suits: 'events and posters: condensed capitals over a geometric sans',
}
const FRAUNCES_WORK_SANS: FontPairing = {
  heading: { family: 'Fraunces', weight: 700 },
  body: { family: 'Work Sans', weight: 400 },
  suits: 'words-only ads with warmth: a soft serif with character over a plain sans',
}
const MONTSERRAT_OPEN_SANS: FontPairing = {
  heading: { family: 'Montserrat', weight: 800 },
  body: { family: 'Open Sans', weight: 400 },
  suits: 'products and comparisons: clean and sturdy',
}

/** The pairings given when no kind of ad is. */
const ANY_KIND_FONTS = [MONTSERRAT_OPEN_SANS, PLAYFAIR_LATO, SPACE_GROTESK_INTER, BEBAS_MONTSERRAT]

/** What each kind of ad leads with, and the pairings that suit it. */
const KINDS: Record<AdKind, { lead: string; fonts: FontPairing[] }> = {
  sale: {
    lead: 'Lead with the offer in the biggest type: the discount, the price or “Half price”, as the person gave it. Then what is on sale, and the end date only if given; one button, such as Shop now. A badge or a highlighted word draws the eye.',
    fonts: [ANTON_INTER, ARCHIVO, BEBAS_MONTSERRAT],
  },
  launch: {
    lead: 'Name what is new and the one thing it does better, and show it large; “New” or “Introducing” as a small label over the headline, and a button such as Discover.',
    fonts: [SPACE_GROTESK_INTER, POPPINS, MONTSERRAT_OPEN_SANS],
  },
  product: {
    lead: 'One product, large, on a calm background or over a third of the frame; its name and one benefit, and the price only if given.',
    fonts: [MONTSERRAT_OPEN_SANS, POPPINS, PLAYFAIR_LATO],
  },
  lifestyle: {
    lead: 'Let the photo carry the ad, people using the product; put the words in a band or on a calm part of the photo, with a shade behind them where the photo is busy.',
    fonts: [PLAYFAIR_LATO, DM_SERIF_SANS, POPPINS],
  },
  quote: {
    lead: 'The quote is the headline, in quotation marks and word for word as given, with the person’s name (and role) below it. Never write a quote or a review yourself.',
    fonts: [DM_SERIF_SANS, PLAYFAIR_LATO, FRAUNCES_WORK_SANS],
  },
  event: {
    lead: 'What, when and where, in that order, with the date and place exactly as given, and a button such as Get tickets or Register.',
    fonts: [BEBAS_MONTSERRAT, ANTON_INTER, SPACE_GROTESK_INTER],
  },
  app: {
    lead: 'What the app does for the person in one line, a phone showing the app’s screen if one is given, and a button such as Get the app.',
    fonts: [SPACE_GROTESK_INTER, POPPINS, MONTSERRAT_OPEN_SANS],
  },
  'before-after': {
    lead: 'Two halves framed the same way, labelled Before and After, and one line on the result; only a result the person gave.',
    fonts: [MONTSERRAT_OPEN_SANS, POPPINS, ARCHIVO],
  },
  comparison: {
    lead: 'Two columns or rows, the brand’s side marked and first to the eye; compare only on points the person gave, and name another brand only when asked to.',
    fonts: [MONTSERRAT_OPEN_SANS, ARCHIVO, SPACE_GROTESK_INTER],
  },
  benefits: {
    lead: 'A headline and up to three benefits of a few words each, with an icon each; more than three are not read.',
    fonts: [POPPINS, MONTSERRAT_OPEN_SANS, FREDOKA_NUNITO],
  },
  'big-number': {
    lead: 'One number, as large as the frame takes, and a line saying what it means; the number only as given.',
    fonts: [ARCHIVO, ANTON_INTER, BEBAS_MONTSERRAT],
  },
  'words-only': {
    lead: 'One idea in big type on a colour or a gradient, with the logo and a button; a typeface with character carries the ad.',
    fonts: [FRAUNCES_WORK_SANS, BEBAS_MONTSERRAT, DM_SERIF_SANS],
  },
}

/** What the ad rules say of `kind`: what it leads with, and its pairings; with no kind, pairings for any ad. */
export function kindAdvice(kind?: AdKind): { kind?: { name: AdKind; lead: string }; fonts: FontPairing[] } {
  if (!kind) return { fonts: ANY_KIND_FONTS }
  return { kind: { name: kind, lead: KINDS[kind].lead }, fonts: KINDS[kind].fonts }
}
