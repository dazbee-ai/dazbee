// Measures the text matcher on data that stays outside the repo (`text-measure-pieces.ts`): the 48
// test ads, or the test part of LICA, our own realistic set or the synthetic set, with faces loaded as
// match copies from a checkout of google/fonts at `GOOGLE_FONTS`'s commit and the shipped faces from
// `@dazbee/fonts`, in Hybrid or Light.
//   TEST_ADS_DIR=<test ads> node scripts/measure-text.ts <google/fonts checkout> [options]
//   --set ads|lica|own|synthetic   which pieces (ads); a set reads LICA_DIR, OWN_SET_DIR or SYNTH_TEXT_DIR
//   --setting hybrid|light         (hybrid)
//   --held-out                     the 16 held-out ads only
//   --shard <i>/<k>                every k-th piece from the i-th, to run parts side by side
//   --answers <file>               writes each piece's answer and face there, by id
//   --repeat <n>                   runs the pieces n times while another process loads every core, and
//                                  says whether every run gave the same answers
// Prints each piece's decision, face and numbers under a neutral id, then how many are text and how
// many look the same, not approximate (on the held-out and all ads, for the ads), how many have the
// drawn family and exact face (for a set), and the median time a piece and an ad.

import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { isDeepStrictEqual, parseArgs } from 'node:util'

import { matchCopy } from '@dazbee/fonts/match-copy'
import { loadFontFiles } from '@dazbee/fonts/node'
import { loadCanvasKit } from '@dazbee/renderer/node'
import { MatchSetting } from '@dazbee/schema'

import { fontKey } from '../src/text/font-key.ts'
import type { FontSource } from '../src/text/font-source.ts'
import { matchTextWithFace, type TextMatch, type TextMatcherDeps } from '../src/text/match-text.ts'
import { openNodeModel } from '../src/text/model-runtime-node.ts'
import { readTextFiles, TEXT_FILES, type TextFileBytes } from '../src/text/text-files.ts'
import { fetchFiles, FILES_DIR } from './fetch-files.ts'
import { googleFaceFile } from './google-face-file.ts'
import { adPieces, type MeasuredPiece, SET_DIRS, setPieces, type TestSet } from './text-measure-pieces.ts'

/** A piece's answer as the measurement keeps it. */
type Measured = TextMatch['answer'] & { face?: string; familyOk?: boolean; faceOk?: boolean | null; ms: number }

/** Code the loading process runs: a thread spinning on every core. */
const LOAD = `const { Worker } = require('node:worker_threads')
for (let i = 0; i < require('node:os').availableParallelism(); i++) new Worker('for (;;) {}', { eval: true })`

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    set: { type: 'string', default: 'ads' },
    setting: { type: 'string', default: 'hybrid' },
    'held-out': { type: 'boolean', default: false },
    shard: { type: 'string' },
    answers: { type: 'string' },
    repeat: { type: 'string' },
  },
})
const checkout = positionals[0]
const set = values.set as TestSet | 'ads'
const dirVariable = set === 'ads' ? 'TEST_ADS_DIR' : SET_DIRS[set]
const dir = dirVariable ? process.env[dirVariable] : undefined
if (!checkout || !dir) {
  console.error(
    `Usage: ${dirVariable ?? 'TEST_ADS_DIR'}=<folder> node scripts/measure-text.ts <google/fonts checkout> [--set ads|lica|own|synthetic] [--setting hybrid|light] [--held-out] [--shard i/k] [--answers file] [--repeat n]`,
  )
  process.exit(1)
}
const setting = MatchSetting.parse(values.setting)
const ck = await loadCanvasKit()
await fetchFiles()
const bytes = Object.fromEntries(
  TEXT_FILES.map((name) => [name, new Uint8Array(readFileSync(join(FILES_DIR, name)))]),
) as TextFileBytes
const model = await openNodeModel(new Uint8Array(readFileSync(join(FILES_DIR, 'text-model.onnx'))))
const deps: TextMatcherDeps = { ck, files: readTextFiles(bytes), model, fonts: googleFontSource(checkout) }

const [shardIndex, shardCount] = (values.shard ?? '0/1').split('/').map(Number)
const pieces = (set === 'ads' ? adPieces(ck, dir) : setPieces(ck, set, dir))
  .filter((p) => !values['held-out'] || p.heldOut)
  .filter((_, i) => i % (shardCount ?? 1) === (shardIndex ?? 0))
  .map((p) => ({ ...p, job: { ...p.job, setting } }))

const repeat = Number(values.repeat ?? 1)
const loader = repeat > 1 ? spawn(process.execPath, ['-e', LOAD], { stdio: 'ignore' }) : undefined
const runs: Record<string, Measured>[] = []
try {
  for (let run = 0; run < repeat; run++) runs.push(await measure(pieces, run === 0))
} finally {
  loader?.kill()
  await model.release()
}
const answers = runs[0] ?? {}
if (values.answers) writeFileSync(values.answers, JSON.stringify(answers, null, 1))

const count = (list: readonly MeasuredPiece[], ok: (a: Measured) => boolean | null | undefined) => {
  const counted = list.filter((p) => ok(answers[p.id] as Measured) !== null)
  const yes = counted.filter((p) => ok(answers[p.id] as Measured)).length
  return `${yes} of ${counted.length} (${((100 * yes) / Math.max(1, counted.length)).toFixed(1)}%)`
}
const isText = (a: Measured) => a.kind === 'layers'
const looksSame = (a: Measured) => a.kind === 'layers' && !a.approximate
console.log(`\n${setting}, ${set}${values.shard ? `, shard ${values.shard}` : ''}`)
if (set === 'ads') {
  const heldOut = pieces.filter((p) => p.heldOut)
  console.log(`Text, held-out: ${count(heldOut, isText)}`)
  console.log(`Looks the same, held-out: ${count(heldOut, looksSame)}`)
  if (!values['held-out']) {
    console.log(`Text, all 48: ${count(pieces, isText)}`)
    console.log(`Looks the same, all 48: ${count(pieces, looksSame)}`)
  }
  const perAd = new Map<string, number>()
  for (const [id, a] of Object.entries(answers))
    perAd.set(id.split('#')[0] ?? id, (perAd.get(id.split('#')[0] ?? id) ?? 0) + a.ms)
  console.log(`Per ad, median: ${(middle([...perAd.values()]) / 1000).toFixed(2)} s`)
} else {
  console.log(`Text: ${count(pieces, isText)}`)
  console.log(`Looks the same: ${count(pieces, looksSame)}`)
  console.log(`Family: ${count(pieces, (a) => a.familyOk)}`)
  console.log(`Exact face: ${count(pieces, (a) => a.faceOk)}`)
}
console.log(`Per piece, median: ${(middle(Object.values(answers).map((a) => a.ms)) / 1000).toFixed(2)} s`)
if (repeat > 1) {
  const differing = pieces.filter((p) =>
    runs.some((r) => !isDeepStrictEqual(withoutTime(r[p.id]), withoutTime(answers[p.id]))),
  )
  console.log(
    `Repeated ${repeat} times while another process loaded every core: ` +
      (differing.length === 0
        ? `identical answers in every run, ${pieces.length} pieces`
        : `${differing.length} pieces differed: ${differing.map((p) => p.id).join(', ')}`),
  )
}

/** Each piece matched once, by id, printed as it goes when `print`. */
async function measure(list: readonly MeasuredPiece[], print: boolean): Promise<Record<string, Measured>> {
  const measured: Record<string, Measured> = {}
  for (const { id, job, piece, truth } of list) {
    const started = performance.now()
    const { answer, face } = await matchTextWithFace(job, piece, deps)
    const ms = performance.now() - started
    const key = face ? fontKey(face) : undefined
    measured[id] = {
      ...answer,
      ...(key ? { face: key } : {}),
      ...(truth ? { familyOk: face?.family === truth.family, faceOk: truth.face ? key === truth.face : null } : {}),
      ms,
    }
    if (!print) continue
    const { scores } = answer
    const decision = answer.kind === 'picture' ? `picture (${answer.why})` : answer.approximate ? 'approximate' : 'text'
    console.log(
      `${id}  ${decision}  ${key ?? '-'}  ` +
        (scores ? `ssim ${scores.ssim.toFixed(4)} ink missed ${scores.inkMissed.toFixed(4)}` : ''),
    )
  }
  return measured
}

/**
 * A face's bytes: a shipped face's from `@dazbee/fonts`, a Google face's from the checkout, its match
 * copy when asked and HarfBuzz cuts it, else the whole face.
 */
function googleFontSource(checkoutDir: string): FontSource {
  const copies = new Map<string, Uint8Array>()
  const shipped = new Map(loadFontFiles().map((face) => [fontKey(face), face.bytes]))
  return {
    face: async (key, copy) => {
      const shippedFace = shipped.get(key)
      if (shippedFace) return shippedFace
      const path = googleFaceFile(checkoutDir, key)?.path
      if (!path) return null
      if (!copy) return new Uint8Array(readFileSync(path))
      let face = copies.get(path)
      if (!face) {
        const whole = new Uint8Array(readFileSync(path))
        face = matchCopy(whole) ?? whole
        copies.set(path, face)
      }
      return face
    },
  }
}

/** The middle value, the higher of the two middle ones for an even count; 0 for none. */
function middle(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] ?? 0
}

/** An answer with the time it took left out, as 0. */
function withoutTime(measured: Measured | undefined): Measured | undefined {
  return measured && { ...measured, ms: 0 }
}
