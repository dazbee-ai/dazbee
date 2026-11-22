// Copies the files the editor loads at runtime into public/vendor: CanvasKit's wasm, our fonts, and
// ONNX Runtime Web's WebAssembly-only build, which the text matcher runs its model on. They are bytes
// we control (CLAUDE.md), served from our own origin.
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

import { WASM_FILE } from '@dazbee/canvaskit/wasm'
import { FONT_FACES } from '@dazbee/fonts'
import { FONT_FILES_DIR } from '@dazbee/fonts/node'

const require = createRequire(import.meta.url)
const out = join(import.meta.dirname, '..', 'public', 'vendor')
mkdirSync(join(out, 'fonts'), { recursive: true })
// Under its hashed name only, so an older build's wasm never lingers to be served.
for (const file of readdirSync(out)) if (file.startsWith('canvaskit')) rmSync(join(out, file))
copyFileSync(join(dirname(require.resolve('@dazbee/canvaskit')), 'canvaskit.wasm'), join(out, WASM_FILE))
for (const face of FONT_FACES) copyFileSync(join(FONT_FILES_DIR, face.file), join(out, 'fonts', face.file))

// ONNX Runtime Web under its version only, as `matcher-files.ts` in the editor asks for it. Its JavaScript, with the
// module that loads its WebAssembly inside, is bundled into the matcher worker, so the .wasm is the one file it fetches.
const ortWasm = require.resolve('onnxruntime-web/ort-wasm-simd-threaded.wasm')
const { version } = JSON.parse(readFileSync(join(dirname(ortWasm), '..', 'package.json'), 'utf8')) as {
  version: string
}
rmSync(join(out, 'onnxruntime'), { recursive: true, force: true })
mkdirSync(join(out, 'onnxruntime', version), { recursive: true })
copyFileSync(ortWasm, join(out, 'onnxruntime', version, 'ort-wasm-simd-threaded.wasm'))
