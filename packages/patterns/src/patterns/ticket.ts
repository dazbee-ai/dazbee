// Ticket: the date on a ticket's stub, set as large as it fits, a row of punched holes where it tears off, and the
// event's words and button on the ticket's main part. The style draws the ticket: white on brand colour with the stub
// in the accent over a hard shadow (bold), a pale tint edged in a fine line (minimal), rounded with the stub in the
// accent (playful), or the light colour on a deep ground with a fine inner line (premium).
import type { Build } from '../build.ts'
import { card } from '../card.ts'
import type { Pattern } from '../types.ts'

export const TICKET: Pattern = {
  id: 'ticket',
  name: 'Ticket',
  kinds: ['event'],
  description:
    'A ticket: the date (`number`, such as “28 Nov” or “Sat 6 pm”) large on its stub, a row of punched holes where it tears off, and the event’s words and button on its main part.',
  needs: ['headline', 'number'],
  takes: ['kicker', 'subline', 'button', 'highlight', 'logo'],
}

/** Builds the ticket in the frame. */
export function ticket(b: Build) {
  card(b, { stub: [{ kind: 'number', text: b.content.number ?? '' }], tear: 'holes' })
}
