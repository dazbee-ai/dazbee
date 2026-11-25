// The bill check, run on a developer's machine against the local database and storage while a local worker
// runs with the sellers' keys: gives a workspace of our own a gift, saves one `ai-steps` job of the AI steps
// asked for, waits for the worker to end it, and prints the call log's rows and their totals by seller, to
// compare with each seller's own usage figures. Its prompts are short fixed test prompts, and its pictures are
// drawn here, never a person's: a plain coloured square, and for the layer split a test ad of shapes and
// block-letter text, split by a fixed layer plan at --size (1024 unless given), with --guidance when given.
//   node apps/worker/src/scripts/check-bills.ts --steps round-plan,read,draft-fast [--seller openai]
//     [--size 512] [--guidance 3] [--workspace dev-workspace] [--member dev-user] [--gift 200]
import { setTimeout as sleep } from 'node:timers/promises'
import { parseArgs } from 'node:util'
import { crc32, deflateSync } from 'node:zlib'

import { asc, eq } from 'drizzle-orm'
import { PgBoss } from 'pg-boss'

import { giveGrant, saveJob } from '@dazbee/ai'
import { aiCalls, aiJobs, openDatabase } from '@dazbee/db'
import { type AiStepsCall, type CallInput, LayerSplitSize } from '@dazbee/schema'
import { openStorage, storageSettings } from '@dazbee/storage'

import { workspaceFiles } from '../steps-job.ts'

/** How long the script waits for the worker to end the job. */
const WAIT_MS = 15 * 60_000

/** A JSON schema for the text steps' answers. */
const IDEAS = {
  type: 'object',
  properties: { ideas: { type: 'array', items: { type: 'string' } } },
  required: ['ideas'],
  additionalProperties: false,
}

const AD = 'A spring sale for a coffee shop: 20% off lattes this week, on a square social post.'

/** The layer plan of the test ad, in the form Ming's layer split reads. */
const AD_PLAN = [
  'Decompose this image into 4 layers with the following specifications:',
  '',
  'Number of layers: 4',
  'Layer 1: Dark brown block-letter text in the upper left reading "SPRING SALE" and, below it, "20% OFF".',
  'Layer 2: A teal rectangular button near the bottom with white block letters reading "SHOP NOW".',
  'Layer 3: A large solid orange circle in the upper right.',
  'Layer 4: Plain cream background filling the whole canvas.',
].join('\n')

/** 5 × 7 bitmaps of the test ad's letters, a row a string, `#` for ink. */
const GLYPHS: Record<string, string[]> = {
  S: [' ####', '#    ', '#    ', ' ### ', '    #', '    #', '#### '],
  P: ['#### ', '#   #', '#   #', '#### ', '#    ', '#    ', '#    '],
  R: ['#### ', '#   #', '#   #', '#### ', '# #  ', '#  # ', '#   #'],
  I: ['#####', '  #  ', '  #  ', '  #  ', '  #  ', '  #  ', '#####'],
  N: ['#   #', '##  #', '# # #', '#  ##', '#   #', '#   #', '#   #'],
  G: [' ####', '#    ', '#    ', '# ###', '#   #', '#   #', ' ####'],
  A: [' ### ', '#   #', '#   #', '#####', '#   #', '#   #', '#   #'],
  L: ['#    ', '#    ', '#    ', '#    ', '#    ', '#    ', '#####'],
  E: ['#####', '#    ', '#    ', '#### ', '#    ', '#    ', '#####'],
  O: [' ### ', '#   #', '#   #', '#   #', '#   #', '#   #', ' ### '],
  F: ['#####', '#    ', '#    ', '#### ', '#    ', '#    ', '#    '],
  H: ['#   #', '#   #', '#   #', '#####', '#   #', '#   #', '#   #'],
  W: ['#   #', '#   #', '#   #', '# # #', '# # #', '## ##', '#   #'],
  '2': [' ### ', '#   #', '    #', '   # ', '  #  ', ' #   ', '#####'],
  '0': [' ### ', '#   #', '#  ##', '# # #', '##  #', '#   #', ' ### '],
  '%': ['##  #', '##  #', '   # ', '  #  ', ' #   ', '#  ##', '#  ##'],
}

const { values } = parseArgs({
  options: {
    steps: { type: 'string' },
    seller: { type: 'string' },
    workspace: { type: 'string', default: 'dev-workspace' },
    member: { type: 'string', default: 'dev-user' },
    gift: { type: 'string', default: '200' },
    size: { type: 'string', default: '1024' },
    guidance: { type: 'string' },
  },
})
if (!values.steps) throw new Error('name the AI steps to run: --steps round-plan,read,draft-fast')
const databaseUrl = process.env.DATABASE_URL ?? 'postgres://dazbee:dazbee-local@127.0.0.1:55432/dazbee'
const { db, close } = openDatabase(databaseUrl)
const storage = openStorage(
  storageSettings({
    STORAGE_ENDPOINT: 'http://127.0.0.1:59000',
    STORAGE_BUCKET: 'dazbee',
    STORAGE_ACCESS_KEY_ID: 'dazbee',
    STORAGE_SECRET_ACCESS_KEY: 'dazbee-local-secret',
    STORAGE_REGION: 'us-east-1',
    ...process.env,
  }),
)
const boss = new PgBoss({ connectionString: databaseUrl, max: 2, supervise: false, schedule: false })
await boss.start()

// Local storage starts empty; the bucket is made once, as the API makes it when STORAGE_CREATE_BUCKET is on.
await storage.ensureBucket()
const files = workspaceFiles(storage, values.workspace)
const picture = await files.save(plainSquare(256), 'image/png')
const ad = await files.save(testAd(768), 'image/png')
const calls: AiStepsCall[] = values.steps.split(',').map((step) => ({
  step,
  input: inputOf(step.trim(), picture, ad),
  ...(values.seller ? { sellers: [values.seller] } : {}),
}))
await giveGrant(db, {
  workspace: values.workspace,
  amount: BigInt(Math.round(Number(values.gift) * 1e6)),
  expiresAt: new Date(Date.now() + 86_400_000),
  note: 'bill check',
})
const saved = await db.transaction((tx) =>
  saveJob(tx, boss, { workspace: values.workspace, member: values.member, kind: 'ai-steps', input: { calls } }),
)
if (!saved.ok) throw new Error(`the job was refused: ${saved.refusal}`)
console.log(`job ${saved.job} saved with ${calls.length} calls; waiting for the worker`)

const ended = await waitForEnd(saved.job)
const rows = await db
  .select()
  .from(aiCalls)
  .where(eq(aiCalls.jobId, saved.job))
  .orderBy(asc(aiCalls.callIndex), asc(aiCalls.try))
console.table(
  rows.map((row) => ({
    call: row.callIndex,
    step: row.step,
    model: row.model,
    seller: row.seller,
    state: row.state,
    seconds: row.endedAt ? ((row.endedAt.getTime() - row.startedAt.getTime()) / 1000).toFixed(1) : '',
    usage: JSON.stringify(row.usage),
    sellerCost: money(row.sellerCost),
    currency: row.currency,
    realCostInr: money(row.realCost),
    request: row.sellerRequestId,
    error: row.error?.slice(0, 80),
  })),
)
const totals = new Map<string, { calls: number; sellerCost: bigint; realCost: bigint; currency: string }>()
for (const row of rows) {
  if (row.state !== 'done') continue
  const total = totals.get(row.seller) ?? { calls: 0, sellerCost: 0n, realCost: 0n, currency: row.currency ?? '' }
  total.calls++
  total.sellerCost += row.sellerCost ?? 0n
  total.realCost += row.realCost ?? 0n
  totals.set(row.seller, total)
}
console.table(
  [...totals].map(([seller, t]) => ({
    seller,
    calls: t.calls,
    sellerCost: `${money(t.sellerCost)} ${t.currency}`,
    realCostInr: money(t.realCost),
  })),
)
console.log(`job ${saved.job} ended ${ended.state}${ended.error ? `: ${ended.error}` : ''}`)
await boss.stop({ graceful: false })
await close()

function inputOf(step: string, picture: string, ad: string): CallInput {
  const text = (instructions: string, prompt: string, pictures: string[] = []): CallInput => ({
    kind: 'text',
    instructions,
    prompt,
    pictures,
    schema: IDEAS,
    maxOutputTokens: 2000,
  })
  const draft: CallInput = { kind: 'picture', prompt: `A flat illustration ad. ${AD}`, width: 1024, height: 1024 }
  const edit: CallInput = {
    kind: 'picture-edit',
    prompt: `Make it a ${AD}`,
    pictures: [picture],
    width: 1024,
    height: 1024,
  }
  switch (step) {
    case 'round-plan':
      return text('List three short layout ideas for the ad.', AD)
    case 'read':
      return text('List the colours you see in the picture.', 'What colours are in this picture?', [picture])
    case 'layer-plan':
      return text('List the layers a designer would make for the ad.', AD)
    case 'draft-fast':
    case 'draft-precise':
      return draft
    case 'refine':
    case 'resize':
      return edit
    case 'layer-split':
      return {
        kind: 'layer-split',
        picture: ad,
        size: LayerSplitSize.parse(Number(values.size)),
        plan: AD_PLAN,
        ...(values.guidance ? { guidance: Number(values.guidance) } : {}),
      }
    default:
      throw new Error(`the bill check has no input for ${step}`)
  }
}

async function waitForEnd(job: string) {
  const until = Date.now() + WAIT_MS
  while (Date.now() < until) {
    const [row] = await db.select().from(aiJobs).where(eq(aiJobs.id, job))
    if (row?.endedAt) return row
    await sleep(2_000)
  }
  throw new Error(`job ${job} did not end in ${WAIT_MS / 60_000} minutes`)
}

function money(millionths: bigint | null): string {
  return millionths === null ? '' : (Number(millionths) / 1e6).toFixed(6)
}

/** A plain blue-green square PNG of `side` pixels. */
function plainSquare(side: number): Uint8Array {
  const pixels = Buffer.alloc(side * side * 3)
  for (let i = 0; i < side * side; i++) pixels.set([40, 160, 150], i * 3)
  return png(side, side, pixels)
}

/**
 * A square test ad PNG of `side` pixels: a cream background, an orange circle, the block-letter headline
 * "SPRING SALE" over "20% OFF", and a teal "SHOP NOW" button, as `AD_PLAN` describes it.
 */
function testAd(side: number): Uint8Array {
  const pixels = Buffer.alloc(side * side * 3)
  const paint = (x: number, y: number, colour: number[]) => {
    if (x >= 0 && y >= 0 && x < side && y < side) pixels.set(colour, (y * side + x) * 3)
  }
  const box = (x0: number, y0: number, x1: number, y1: number, colour: number[]) => {
    for (let y = Math.round(y0); y < y1; y++) for (let x = Math.round(x0); x < x1; x++) paint(x, y, colour)
  }
  const text = (words: string, x0: number, y0: number, cell: number, colour: number[]) => {
    for (const [i, letter] of [...words].entries()) {
      for (const [row, line] of (GLYPHS[letter] ?? []).entries()) {
        for (const [column, ink] of [...line].entries()) {
          const x = x0 + (i * 6 + column) * cell
          if (ink === '#') box(x, y0 + row * cell, x + cell, y0 + (row + 1) * cell, colour)
        }
      }
    }
  }
  const u = side / 768
  const brown = [80, 45, 30]
  box(0, 0, side, side, [246, 238, 222])
  const [cx, cy, r] = [600 * u, 190 * u, 140 * u]
  for (let y = Math.floor(cy - r); y < cy + r; y++) {
    for (let x = Math.floor(cx - r); x < cx + r; x++)
      if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) paint(x, y, [240, 130, 50])
  }
  text('SPRING', 60 * u, 90 * u, 9 * u, brown)
  text('SALE', 60 * u, 170 * u, 9 * u, brown)
  text('20% OFF', 60 * u, 300 * u, 11 * u, brown)
  box(170 * u, 560 * u, 600 * u, 680 * u, [30, 140, 140])
  text('SHOP NOW', 218 * u, 595 * u, 7 * u, [255, 255, 255])
  return png(side, side, pixels)
}

/** An RGB PNG of `width` × `height` from `pixels`, three bytes each, row by row. */
function png(width: number, height: number, pixels: Buffer): Uint8Array {
  const rows = Buffer.concat(
    Array.from({ length: height }, (_, y) =>
      Buffer.concat([Buffer.from([0]), pixels.subarray(y * width * 3, (y + 1) * width * 3)]),
    ),
  )
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    const check = Buffer.alloc(4)
    check.writeUInt32BE(crc32(body))
    return Buffer.concat([length, body, check])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header.set([8, 2, 0, 0, 0], 8)
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}
