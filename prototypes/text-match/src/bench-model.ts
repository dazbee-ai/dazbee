// PROTOTYPE. Times the fingerprint model on one thread: milliseconds a window, for each ONNX file given
// (a model folder means its model.onnx).
//   node src/bench-model.ts .data/models/cat-w16-p48 .data/models/x/model.int8.onnx
import { join } from 'node:path'

import { openModel } from './fingerprint.ts'

for (const arg of process.argv.slice(2)) {
  const file = arg.endsWith('.onnx') ? arg : join(arg, 'model.onnx')
  const t0 = performance.now()
  const model = await openModel(file, 1)
  const open = performance.now() - t0
  const { height, window } = model.geometry
  const windows = Array.from({ length: 8 }, () =>
    Uint8Array.from({ length: height * window }, () => Math.random() * 255),
  )
  await model.embedWindows(windows)
  const t = performance.now()
  for (let i = 0; i < 10; i++) await model.embedWindows(windows)
  console.log(file, `open ${open.toFixed(0)} ms`, `${((performance.now() - t) / 80).toFixed(2)} ms/window`)
}
