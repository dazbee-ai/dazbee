// The days the admin pages' costs and daily check cover, read from the address, and the address's other
// settings.
import { UtcDay } from '@dazbee/schema'

/** The days shown when the address names none: the last 14 UTC days, today's included. */
const DEFAULT_DAYS = 14

/** The most days apart the API takes. */
const MOST_DAYS = 92

/**
 * The UTC days the address names, `from` not after `to` and at most `MOST_DAYS` apart; otherwise the last
 * `DEFAULT_DAYS`, `refused` when the address named days.
 */
export function daysOf(query: { from: string | undefined; to: string | undefined }): {
  from: string
  to: string
  refused: boolean
} {
  const from = UtcDay.safeParse(query.from)
  const to = UtcDay.safeParse(query.to)
  if (from.success && to.success) {
    const apart = (Date.parse(to.data) - Date.parse(from.data)) / 86_400_000
    if (apart >= 0 && apart <= MOST_DAYS) return { from: from.data, to: to.data, refused: false }
  }
  const today = Date.now()
  return {
    from: new Date(today - (DEFAULT_DAYS - 1) * 86_400_000).toISOString().slice(0, 10),
    to: new Date(today).toISOString().slice(0, 10),
    refused: Boolean(query.from || query.to),
  }
}

/** The first of a setting the address gives more than once. */
export function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

/** The address's settings that are set. */
export function pick(settings: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(Object.entries(settings).filter((entry): entry is [string, string] => Boolean(entry[1])))
}
