// Measures the shape matcher's goals (the matchers spec's goals table) with `matchShapesOf`, and checks its
// answers against the shape baseline piece by piece:
//   node scripts/measure-shapes.ts measure <baseline.json> [--table]
//   node scripts/measure-shapes.ts repeat <baseline.json> <runs> [--coupon-only]
// `TEST_ADS_DIR` names the test ads' folder (a folder per ad with blocks.json and its block crops) and `SYNTH_DIR`
// synthetic set 2's (index.json and <id>.png); both stay outside the repo, and so does the baseline: the shape
// prototype's ladder run with the fitted rule, one answer a piece, which names the dashed coupon's piece.
// - measure: the 47 held-out shape pieces and the 25 held-out photo and cutout pieces sent as shapes (every third ad
//   in name order, from the third), synthetic set 2 (312) and the dashed coupon. Prints each answer that differs
//   from the baseline's, the goals' counts, and with --table every piece's answer. Test-ad pieces are named
//   `adNN/BB`, block BB of the NNth ad in name order, so the output names no test ad.
// - repeat: the held-out pieces and the coupon (or the coupon alone) answered in `runs` fresh processes, one after
//   another, while a process on every core spins; prints whether every run gave the same answers.
// - answers: the held-out pieces and the coupon (or the coupon alone), each whole answer on a line; repeat runs it.
// Run it on the repo's Node (`.nvmrc`), the one the apps' images run; it refuses an older one.
import { spawn, spawnSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'

import type { CanvasKit } from '@dazbee/canvaskit'
import { loadCanvasKit } from '@dazbee/renderer/node'
import type { MatchAnswer, MatchKit } from '@dazbee/schema'

import { matchShapesOf } from '../src/shape/match-shapes.ts'
import { photoScore } from '../src/shape/photo-guard.ts'
import { decodePng, type PrototypeAnswer, prototypeAnswer } from '../src/shape/test-pieces.ts'

/** The baseline's answer for a piece, as the prototype wrote it, with the photo guard's score of its graphics. */
interface BaselineAnswer extends PrototypeAnswer {
  photoP: number | null
}

/** A piece measured: where its pixels are, what it is, the kit it is matched with and the baseline's answer. */
interface MeasuredPiece {
  /** The name printed: `adNN/BB`, `s2-N` or `coupon`. */
  name: string
  set: 'heldOut' | 'synth2' | 'coupon'
  /** `shape`, `graphic`, `background`, `photo` or `cutout` for a test-ad piece; for set 2, what it should become. */
  kind: string
  path: string
  colors: MatchKit['colors']
  baseline: BaselineAnswer
}

interface BaselineRow {
  id: string
  set: 'frozen' | 'synth2' | 'coupon'
  kind: string
  ladder: BaselineAnswer
}

const SHAPE_KINDS = ['shape', 'graphic', 'background']
const PHOTO_KINDS = ['photo', 'cutout']
/** Synthetic set 2's families that are pictures and should stay pictures. */
const PICTURE_FAMILIES = ['photo', 'render']

const [mode, baselinePath, runsArg] = process.argv.slice(2)
const flags = new Set(process.argv.slice(2).filter((arg) => arg.startsWith('--')))
const testAds = process.env.TEST_ADS_DIR
const synthDir = process.env.SYNTH_DIR
if (!baselinePath || !testAds || !synthDir || !['measure', 'repeat', 'answers'].includes(mode ?? '')) {
  console.error(
    'Usage: TEST_ADS_DIR=… SYNTH_DIR=… node scripts/measure-shapes.ts measure|repeat|answers <baseline.json> [runs] [--table] [--coupon-only]',
  )
  process.exit(1)
}

const repoNode = Number(readFileSync(join(import.meta.dirname, '..', '..', '..', '.nvmrc'), 'utf8').trim())
if (Number(process.versions.node.split('.')[0]) < repoNode) {
  console.error(`Run it on Node ${repoNode} (.nvmrc), not ${process.versions.node}.`)
  process.exit(1)
}

const pieces = measuredPieces(
  testAds,
  synthDir,
  JSON.parse(readFileSync(baselinePath, 'utf8')) as { pieces: BaselineRow[] },
)
if (mode === 'measure') await measure(pieces)
else if (mode === 'repeat') repeat(Number(runsArg ?? 5))
else
  await answers(
    pieces.filter((piece) => piece.set !== 'synth2' && (!flags.has('--coupon-only') || piece.set === 'coupon')),
  )

/** Answers every piece, compares each with the baseline and prints the goals' counts. */
async function measure(all: readonly MeasuredPiece[]) {
  const ck = await loadCanvasKit()
  const rows: { piece: MeasuredPiece; answer: MatchAnswer; ms: number }[] = []
  let same = 0
  for (const piece of all) {
    const started = performance.now()
    const answer = matchShapesOf(ck, read(ck, piece.path), piece.colors)
    const ms = performance.now() - started
    rows.push({ piece, answer, ms })
    const problems = differences(ck, piece, answer)
    if (problems.length) console.log(`DIFF ${piece.name}: ${problems.join('; ')}`)
    else same++
  }
  const madeShapes = (rs: typeof rows) => rs.filter((r) => r.answer.kind === 'layers').length
  const of = (set: MeasuredPiece['set'], kinds: readonly string[]) =>
    rows.filter((r) => r.piece.set === set && kinds.includes(r.piece.kind))
  const heldOutShapes = of('heldOut', SHAPE_KINDS)
  const heldOutPhotos = of('heldOut', PHOTO_KINDS)
  const synthShapes = rows.filter((r) => r.piece.set === 'synth2' && !PICTURE_FAMILIES.includes(r.piece.kind))
  const synthPictures = of('synth2', PICTURE_FAMILIES)
  const coupon = rows.find((r) => r.piece.set === 'coupon')
  const baselineShapes = (rs: typeof rows) => rs.filter((r) => r.piece.baseline.decision === 'shapes').length
  const times = rows.map((r) => r.ms).sort((a, b) => a - b)
  console.log(`\nSame as the baseline: ${same} of ${rows.length}`)
  console.log(
    `Held-out shape pieces that look the same: ${madeShapes(heldOutShapes)} of ${heldOutShapes.length} (baseline ${baselineShapes(heldOutShapes)})`,
  )
  console.log(
    `Synthetic set 2, should be shapes and look the same: ${madeShapes(synthShapes)} of ${synthShapes.length} (baseline ${baselineShapes(synthShapes)})`,
  )
  console.log(
    `Synthetic set 2, pictures made shapes: ${madeShapes(synthPictures)} of ${synthPictures.length} (baseline ${baselineShapes(synthPictures)})`,
  )
  console.log(
    `Held-out photos and cutouts made shapes: ${madeShapes(heldOutPhotos)} of ${heldOutPhotos.length} (baseline ${baselineShapes(heldOutPhotos)})`,
  )
  if (coupon)
    console.log(
      `Dashed coupon: ${summary(coupon.answer)} (baseline ${coupon.piece.baseline.decision}, ${coupon.piece.baseline.layers.length} layers)`,
    )
  console.log(
    `Per piece: median ${(times[Math.floor(times.length / 2)] ?? 0).toFixed(0)} ms, slowest ${(times.at(-1) ?? 0).toFixed(0)} ms`,
  )
  if (flags.has('--table')) {
    console.log('\n| Piece | Kind | Answer | Its shapes | Far |\n| --- | --- | --- | --- | --- |')
    for (const { piece, answer } of rows) {
      const far = answer.scores ? answer.scores.far.toFixed(4) : '-'
      console.log(`| ${piece.name} | ${piece.kind} | ${summary(answer)} | ${shapeKinds(answer)} | ${far} |`)
    }
  }
}

/** Runs the held-out pieces and the coupon in `runs` fresh processes under load, and says whether every run agreed. */
function repeat(runs: number) {
  const spinners = Array.from({ length: availableParallelism() }, () =>
    spawn(process.execPath, ['-e', 'for (;;) {}'], { stdio: 'ignore' }),
  )
  try {
    const outputs: string[] = []
    for (let run = 1; run <= runs; run++) {
      const started = performance.now()
      const child = spawnSync(
        process.execPath,
        [import.meta.filename, 'answers', baselinePath ?? '', ...(flags.has('--coupon-only') ? ['--coupon-only'] : [])],
        { encoding: 'utf8', maxBuffer: 1 << 28 },
      )
      if (child.status !== 0) throw new Error(`run ${run} failed: ${child.stderr}`)
      outputs.push(child.stdout)
      const lines = child.stdout.trim().split('\n')
      const flips = lines.filter((line, i) => line !== outputs[0]?.trim().split('\n')[i])
      console.log(
        `run ${run}: ${lines.length} pieces, ${((performance.now() - started) / 1000).toFixed(0)} s, ${flips.length ? `${flips.length} differ from run 1: ${flips.map((line) => line.split('\t')[0]).join(', ')}` : 'the same as run 1'}`,
      )
    }
    const identical = outputs.every((output) => output === outputs[0])
    console.log(
      `${runs} runs under load on ${spinners.length} spinning processes: ${identical ? 'identical' : 'NOT identical'}`,
    )
    if (!identical) process.exitCode = 1
  } finally {
    for (const spinner of spinners) spinner.kill()
  }
}

/** Prints each piece's whole answer on a line of its own, for `repeat` to compare. */
async function answers(chosen: readonly MeasuredPiece[]) {
  const ck = await loadCanvasKit()
  for (const piece of chosen) {
    const answer = matchShapesOf(ck, read(ck, piece.path), piece.colors)
    console.log(`${piece.name}\t${JSON.stringify(answer)}`)
  }
}

/** The pieces the baseline holds, in its order, each found under its folder and named so no test ad is. */
function measuredPieces(ads: string, synth: string, baseline: { pieces: BaselineRow[] }): MeasuredPiece[] {
  const adNames = readdirSync(ads).sort()
  const heldOut = new Set(adNames.filter((_, i) => i % 3 === 2))
  const index = JSON.parse(readFileSync(join(synth, 'index.json'), 'utf8')) as {
    id: number
    family: string
    kit: { token: string; value: string }[]
  }[]
  const synthOf = new Map(index.map((entry) => [entry.id, entry]))
  const adName = (id: string) => {
    const [ad = '', file = ''] = id.split('/')
    return `ad${String(adNames.indexOf(ad) + 1).padStart(2, '0')}/${/(\d+)/.exec(file)?.[1] ?? file}`
  }
  const chosen = baseline.pieces.map((row): MeasuredPiece => {
    if (row.set === 'synth2') {
      const entry = synthOf.get(Number(row.id.slice('synth2/'.length)))
      if (!entry) throw new Error(`synthetic set 2 has no piece ${row.id}`)
      const colors = Object.fromEntries(entry.kit.map((colour) => [colour.token, colour.value])) as MatchKit['colors']
      return {
        name: `s2-${entry.id}`,
        set: 'synth2',
        kind: entry.family,
        path: join(synth, `${entry.id}.png`),
        colors,
        baseline: row.ladder,
      }
    }
    const set = row.set === 'coupon' ? 'coupon' : 'heldOut'
    if (set === 'heldOut' && !heldOut.has(row.id.split('/')[0] ?? ''))
      throw new Error(`${adName(row.id)} is not a held-out ad`)
    return {
      name: set === 'coupon' ? 'coupon' : adName(row.id),
      set,
      kind: row.kind,
      path: join(ads, row.id),
      colors: {},
      baseline: row.ladder,
    }
  })
  // The held-out pieces are every shape, graphic, background, photo and cutout block of the held-out ads.
  const blocks = [...heldOut].flatMap((ad) =>
    (JSON.parse(readFileSync(join(ads, ad, 'blocks.json'), 'utf8')) as { blocks: { kind: string }[] }).blocks.filter(
      (block) => [...SHAPE_KINDS, ...PHOTO_KINDS].includes(block.kind),
    ),
  )
  const counted = chosen.filter((piece) => piece.set === 'heldOut').length
  if (blocks.length !== counted)
    throw new Error(`the held-out ads have ${blocks.length} pieces, the baseline ${counted}`)
  return chosen
}

/** How the answer differs from the baseline's: decision, why, the rule's numbers, every layer and the photo score. */
function differences(ck: CanvasKit, piece: MeasuredPiece, answer: MatchAnswer): string[] {
  const want = piece.baseline
  const problems: string[] = []
  const wanted = prototypeAnswer(want)
  if (answer.kind !== wanted.kind) return [`${summary(answer)}, baseline ${want.decision} (${want.why})`]
  if (!isDeepStrictEqual(answer, wanted))
    problems.push(
      `${summary(answer)} ${JSON.stringify(answer.scores)}, baseline ${summary(wanted)} ${JSON.stringify(wanted.scores)}`,
    )
  if (answer.kind === 'layers') {
    const score = photoScore(ck, read(ck, piece.path), answer.layers)
    if (want.photoP === null || Math.abs(score - want.photoP) > 1e-9)
      problems.push(`photo score ${score}, baseline ${want.photoP}`)
  }
  return problems
}

/** An answer in a few words: shapes and how many, or picture and why. */
function summary(answer: MatchAnswer): string {
  return answer.kind === 'layers' ? `shapes, ${answer.layers.length} layers` : `picture, ${answer.why}`
}

/** The shape kinds of an answer's graphics, back to front. */
function shapeKinds(answer: MatchAnswer): string {
  if (answer.kind !== 'layers') return ''
  return answer.layers.map((layer) => (layer.type === 'graphic' ? layer.props.shape.kind : layer.type)).join(' ')
}

/** A piece's pixels, decoded with CanvasKit as the matchers decode pictures. */
function read(ck: CanvasKit, path: string) {
  return decodePng(ck, readFileSync(path))
}
