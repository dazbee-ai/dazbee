// Where the families we ship sit in Google Fonts' popularity order, as `pnpm --filter @dazbee/fonts
// google-fonts` writes it into `shipped-ranks.json` beside the Google families' list.
import ranks from './shipped-ranks.json' with { type: 'json' }

/** Each family we ship by its place in Google Fonts' popularity order among the Google families, so the chooser lists it there. */
export const SHIPPED_RANKS: Readonly<Record<string, number>> = ranks
