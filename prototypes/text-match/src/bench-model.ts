// PROTOTYPE. Times the fingerprint model on one thread: windows a second, for each model given.
//   node src/bench-model.ts .data/models/cat-w16-p48 .data/models/cat-w32-p48
import { join } from 'node:path'
import { openModel } from './fingerprint.ts'
import { STRIP_HEIGHT, WINDOW } from './ink.ts'
for (const dir of process.argv.slice(2)) {
  const t0 = performance.now()
  const model = await openModel(join(dir, 'model.onnx'), 1)
  const open = performance.now() - t0
  const windows = Array.from({ length: 8 }, () => Uint8Array.from({ length: STRIP_HEIGHT * WINDOW }, () => Math.random() * 255))
  await model.embedWindows(windows)
  const t = performance.now()
  for (let i = 0; i < 10; i++) await model.embedWindows(windows)
  console.log(dir, `open ${open.toFixed(0)} ms`, `${((performance.now() - t) / 80).toFixed(2)} ms/window`)
}
