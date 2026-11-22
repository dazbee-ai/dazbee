// The editor's worker module: each worker the editor starts, the export worker, the image worker and
// the matcher workers, runs this one file, and each job says which it is (an export, a sample, a copy
// or a match message). One module, because Chromium starts a dedicated worker whose script URL differs
// from an earlier one only in its fragment, where the bundler puts which code it runs, with the
// earlier one's: an image worker started after an export ran the export's code. The matcher's code,
// with ONNX Runtime, is loaded only by a worker sent a match message.
import type { ExportJob, ExportReply, SampleJob } from './export/export-client.ts'
import { exportJob, sampleJob } from './export/export-worker.ts'
import type { CopyJob, CopyReply } from './image-client.ts'
import { copyJob } from './image-worker.ts'
import type { MatchMessage, MatchReply } from './matching/match-pool.ts'

/** What this file uses of a dedicated worker's global scope, which the DOM types don't describe. */
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<ExportJob | SampleJob | CopyJob | MatchMessage>) => void) | null
  postMessage(message: ExportReply | CopyReply | MatchReply, transfer?: Transferable[]): void
}

/** The matcher worker's code, loaded with the first match message. */
let matcher: Promise<typeof import('./matching/match-worker.ts')> | undefined

scope.onmessage = ({ data: job }) => {
  const answer = (reply: ExportReply | CopyReply | MatchReply, transfer: Transferable[] = []) =>
    scope.postMessage(reply, transfer)
  if (job.kind === 'copy') void copyJob(job, answer)
  else if (job.kind === 'sample') void sampleJob(job, answer)
  else if (job.kind === 'export') void exportJob(job, answer)
  else void match(job, answer)
}

/**
 * Answers a match message with the matcher's code, loaded once. A worker whose code doesn't load
 * didn't start, or broke on the piece it was sent.
 */
async function match(message: MatchMessage, answer: (reply: MatchReply) => void) {
  try {
    await (await (matcher ??= import('./matching/match-worker.ts'))).matchMessage(message, answer)
  } catch (error) {
    matcher = undefined
    const said = error instanceof Error ? error.message : String(error)
    if (message.kind === 'matchStart') answer({ kind: 'matchStartFailed', message: said })
    else if (message.kind === 'matchPiece') answer({ kind: 'matchBroken', id: message.id, message: said })
  }
}
