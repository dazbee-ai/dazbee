// The usage files an admin uploads for the sellers with no cost report to fetch (Meta and Pixazo): Meta's
// usage export (a row per day, metric and series), or a CSV with a day column and a cost column read by their
// headers, added up by UTC day and checked
// against the call log as the daily check checks a report.
import { desc, eq } from 'drizzle-orm'

import { aiSellerFiles, type Db, newId } from '@dazbee/db'
import type { SellerFileUpload, UploadedSeller } from '@dazbee/schema'

import { checkDay } from './daily-check.ts'

/** A file's cost by UTC day, in its currency. */
export interface SellerFileDays {
  currency: string
  days: Map<string, number>
}

/** A file that can't be read, with why. */
export class SellerFileRefused extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SellerFileRefused'
  }
}

/** The currency each seller bills our account in, when its file names none. */
const BILLED_IN: Record<UploadedSeller, string> = { meta: 'INR', pixazo: 'USD' }

/** Header words that name a file's day and cost columns. */
const DAY_WORDS = ['date', 'day', 'time', 'created']
const COST_WORDS = ['spend', 'cost', 'amount', 'total', 'charge']

/** Currency symbols a cost may carry. */
const SYMBOLS: Record<string, string> = { '₹': 'INR', $: 'USD' }

/**
 * Reads an uploaded file, keeps it, and checks each day it covers; the days. Throws `SellerFileRefused` for a
 * file of the wrong shape.
 */
export async function uploadSellerFile(
  db: Db,
  upload: SellerFileUpload,
  uploadedBy: string,
): Promise<{ days: string[] }> {
  const read = readSellerFile(upload.seller, upload.text)
  await db.insert(aiSellerFiles).values({
    id: newId(),
    seller: upload.seller,
    name: upload.name,
    uploadedBy,
    currency: read.currency,
    days: Object.fromEntries([...read.days].map(([day, cost]) => [day, String(Math.round(cost * 1e6))])),
  })
  const days = [...read.days.keys()].sort()
  for (const day of days) {
    await checkDay(db, upload.seller, day, { currency: read.currency, cost: read.days.get(day) ?? 0 }, 'upload')
  }
  return { days }
}

/** Reads `text`, a seller's CSV export, into its cost by UTC day. */
export function readSellerFile(seller: UploadedSeller, text: string): SellerFileDays {
  const rows = parseCsv(text.replace(/^\uFEFF/, '')).filter((row) => row.some((cell) => cell.trim() !== ''))
  const [header, ...body] = rows
  if (!header) throw new SellerFileRefused('The file is empty')
  const names = header.map((name) => name.trim().toLowerCase())
  const at = (name: string) => names.indexOf(name)
  // Meta's export is long: a row per day, metric and series, whose spend is `spend` / `total` in `unit`.
  if (at('metric') >= 0 && at('value') >= 0 && at('date') >= 0) {
    const spend = body.filter(
      (row) => row[at('metric')]?.trim() === 'spend' && (row[at('series')] ?? 'total').trim() === 'total',
    )
    return addUp(seller, spend, { dayAt: at('date'), costAt: at('value'), currencyAt: at('unit'), named: null })
  }
  const dayAt = names.findIndex((name) => DAY_WORDS.some((word) => name.includes(word)))
  const costAt = names.findIndex((name) => COST_WORDS.some((word) => name.includes(word)))
  if (dayAt < 0 || costAt < 0) {
    throw new SellerFileRefused(`The file needs a day column and a cost column; its columns are ${header.join(', ')}`)
  }
  const named = /\(([a-z]{3})\)/i.exec(header[costAt] ?? '')?.[1]?.toUpperCase() ?? null
  return addUp(seller, body, { dayAt, costAt, currencyAt: at('currency'), named })
}

/** When each uploaded seller was last checked: the newest day its newest file covered, and when it came. */
export async function lastChecked(
  db: Db,
): Promise<{ seller: UploadedSeller; day: string | null; uploadedAt: Date | null }[]> {
  const sellers: UploadedSeller[] = ['meta', 'pixazo']
  return Promise.all(
    sellers.map(async (seller) => {
      const [file] = await db
        .select({ days: aiSellerFiles.days, uploadedAt: aiSellerFiles.uploadedAt })
        .from(aiSellerFiles)
        .where(eq(aiSellerFiles.seller, seller))
        .orderBy(desc(aiSellerFiles.uploadedAt))
        .limit(1)
      const day = file ? (Object.keys(file.days).sort().at(-1) ?? null) : null
      return { seller, day, uploadedAt: file?.uploadedAt ?? null }
    }),
  )
}

/** Adds `rows` up by UTC day from the columns given, in the currency the file or its seller names. */
function addUp(
  seller: UploadedSeller,
  rows: string[][],
  { dayAt, costAt, currencyAt, named }: { dayAt: number; costAt: number; currencyAt: number; named: string | null },
): SellerFileDays {
  let currency = named
  const days = new Map<string, number>()
  for (const row of rows) {
    const day = utcDay(row[dayAt] ?? '')
    const raw = (row[costAt] ?? '').trim()
    if (!day || raw === '') throw new SellerFileRefused(`A row has no day or no cost: ${row.join(', ')}`)
    const symbol = Object.keys(SYMBOLS).find((s) => raw.includes(s))
    currency ??=
      (currencyAt >= 0 ? row[currencyAt]?.trim().toUpperCase() : undefined) || (symbol && SYMBOLS[symbol]) || null
    const cost = Number(raw.replace(/[^0-9.-]/g, ''))
    if (!Number.isFinite(cost)) throw new SellerFileRefused(`A cost is not a number: ${raw}`)
    days.set(day, Math.round(((days.get(day) ?? 0) + cost) * 1e6) / 1e6)
  }
  if (days.size === 0) throw new SellerFileRefused('The file has no rows')
  return { currency: currency ?? BILLED_IN[seller], days }
}

/** The UTC day a cell names, as YYYY-MM-DD, or null. */
function utcDay(cell: string): string | null {
  const text = cell.trim()
  const iso = /^(\d{4})[-/](\d{2})[-/](\d{2})/.exec(text)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  const parsed = Date.parse(`${text} UTC`)
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString().slice(0, 10)
}

/** The rows of a CSV, with quoted cells. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"'
        i++
      } else if (c === '"') quoted = false
      else cell += c
    } else if (c === '"') quoted = true
    else if (c === ',') {
      row.push(cell)
      cell = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += c
  }
  if (cell !== '' || row.length > 0) rows.push([...row, cell])
  return rows
}
