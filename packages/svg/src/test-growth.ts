// How a reader's time grows with the length of its input, how many times longer one run takes
// than another, and how long one read takes, measured so that a crowded machine doesn't change the
// answer: what the tests of hostile files check linear time and a bounded time with.

/** The most `growth` may give for an input ten times as long: well above linear, well below quadratic. */
export const MAX_GROWTH = 30

/** The clock `growth` times runs with, in milliseconds, once it has been picked. */
let clock: (() => number) | undefined

/**
 * What `read` makes of `large`, and how many times longer it takes on `large` than on `small`, an
 * input a tenth as long. `times` is about 10 when the time grows linearly and about 100 when it
 * grows quadratically.
 *
 * Each sample times 10 runs of `small` back to back against 1 run of `large`, so the two take about
 * as long and a crowded machine slows both alike, and the fastest of up to 5 samples of each counts.
 * The samples stop once they have taken 1 s in all, so quadratic code fails after about one sample.
 */
export function growth<T>(read: (text: string) => T, small: string, large: string): { result: T; times: number } {
  const tenSmall = () => {
    for (let run = 0; run < 10; run++) read(small)
  }
  const { result, took, baselineTook } = fastest(
    () => read(large),
    tenSmall,
    () => read(small),
  )
  return { result, times: (10 * took) / baselineTook }
}

/**
 * What `run` gives, and how many times longer it takes than `baseline`, the same work without what
 * the test adds. Each sample times `baseline` then `run`, so a crowded machine slows both alike, and
 * the fastest of up to 5 samples of each counts, as in `growth`.
 */
export function timesAsLong<T>(run: () => T, baseline: () => unknown): { result: T; times: number } {
  const { result, took, baselineTook } = fastest(run, baseline, baseline)
  return { result, times: took / baselineTook }
}

/** How long `run` takes, in milliseconds, by the clock `growth` times with. */
export function timeOf(run: () => void): number {
  const now = pickedClock()
  const started = now()
  run()
  return now() - started
}

/**
 * The fastest time of `run` and of `baseline`, from up to 5 samples that each time `baseline` then
 * `run`, after one untimed call of `warm`, so the code they run is compiled before it is timed. The
 * samples stop once they have taken 1 s in all, so code that runs away fails after about one sample.
 */
function fastest<T>(run: () => T, baseline: () => unknown, warm: () => unknown) {
  const now = pickedClock()
  warm()
  let took = Number.POSITIVE_INFINITY
  let baselineTook = Number.POSITIVE_INFINITY
  let result: T | undefined
  let spent = 0
  for (let sample = 0; sample < 5 && spent < 1_000; sample++) {
    const started = now()
    baseline()
    const between = now()
    result = run()
    const ended = now()
    baselineTook = Math.min(baselineTook, between - started)
    took = Math.min(took, ended - between)
    spent += ended - started
  }
  // The first sample always runs, so `result` is what `run` gave.
  return { result: result as T, took, baselineTook }
}

/**
 * The clock reads are timed with, in milliseconds: the process's CPU time, which leaves out the
 * time the machine pauses it, where that clock steps by less than a millisecond; on Windows it steps
 * by 15.6 ms, so the wall clock times the reads there.
 */
function pickedClock() {
  clock ??= cpuSteps() < 1 ? cpuTime : () => performance.now()
  return clock
}

/** The step the CPU clock moves by, in milliseconds: the longest of three steps watched in a busy loop. */
function cpuSteps() {
  const stepAfter = (from: number) => {
    const until = performance.now() + 100
    let at = cpuTime()
    while (at === from && performance.now() < until) at = cpuTime()
    return at
  }
  let at = stepAfter(cpuTime())
  let longest = 0
  for (let step = 0; step < 3; step++) {
    const next = stepAfter(at)
    longest = Math.max(longest, next > at ? next - at : Number.POSITIVE_INFINITY)
    at = next
  }
  return longest
}

/** The process's CPU time so far, user and system, in milliseconds. */
function cpuTime() {
  const { user, system } = process.cpuUsage()
  return (user + system) / 1000
}
