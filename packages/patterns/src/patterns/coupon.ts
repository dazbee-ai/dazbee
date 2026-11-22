// Coupon: the offer on a coupon's stub, set as large as it fits, a line of dashes where it tears off, and the words
// and button on the coupon's main part. The style draws the coupon: white on brand colour with the stub in the accent
// over a hard shadow (bold), a pale tint edged in a fine line (minimal), rounded with the stub in the accent
// (playful), or the light colour on a deep ground with a fine inner line (premium).
import type { Build } from '../build.ts'
import { card } from '../card.ts'
import type { Pattern } from '../types.ts'

export const COUPON: Pattern = {
  id: 'coupon',
  name: 'Coupon',
  kinds: ['sale or offer', 'app download'],
  description:
    'A coupon: the offer (`badge`, such as “−30%” or “₹500 off”) large on its stub, a line of dashes where it tears off, and the words and button on its main part.',
  needs: ['headline', 'badge'],
  takes: ['kicker', 'subline', 'button', 'highlight', 'logo'],
}

/** Builds the coupon in the frame. */
export function coupon(b: Build) {
  card(b, { stub: [{ kind: 'number', text: b.content.badge ?? '' }], tear: 'dashes' })
}
