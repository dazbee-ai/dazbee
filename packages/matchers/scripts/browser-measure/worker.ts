// The measurement's matcher worker: the editor's own worker module (`editor-worker.ts`), unchanged, with each
// answer also telling the page CanvasKit's and ONNX Runtime's heaps after the piece (`heaps`). The editor's worker
// sets `onmessage` as it loads; the heaps are watched before any message comes.
import '../../../editor/src/editor-worker.ts'

import type { MatchMessage, MatchReply } from '../../../editor/src/matching/match-pool.ts'
import { type Heaps, watchHeaps } from './heaps.ts'

/** A matcher's answer as the measurement's worker sends it. */
export type MeasuredReply = MatchReply & { heaps?: Heaps }

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<MatchMessage>) => void) | null
  postMessage(message: MeasuredReply, transfer?: Transferable[]): void
}
const heaps = watchHeaps()
const heard = scope.onmessage
const post = scope.postMessage.bind(scope)

scope.onmessage = (event) => {
  const message = event.data
  if (message.kind === 'matchStart') {
    heaps.know(message.canvasKit, 'canvasKit')
    if (message.matcher === 'text') heaps.know(message.onnxRuntime, 'onnxRuntime')
  }
  heard?.(event)
}
scope.postMessage = (reply, transfer) =>
  post(reply.kind === 'matchAnswer' ? { ...reply, heaps: heaps.read() } : reply, transfer)
