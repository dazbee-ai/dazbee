// The text matcher's real files for its tests: fetched from the release into `.files/` when missing
// (offline, that fails with a sentence naming the file), read, and the model opened in onnxruntime-node.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { fetchFiles, FILES_DIR } from '../../scripts/fetch-files.ts'
import { type NodeModelRuntime, openNodeModel } from './model-runtime-node.ts'
import { readTextFiles, TEXT_FILES, type TextFileBytes, type TextFiles } from './text-files.ts'

/** The text matcher's files read, and its model opened. */
export async function textMatcherFiles(): Promise<{ files: TextFiles; model: NodeModelRuntime }> {
  await fetchFiles()
  const bytes = Object.fromEntries(
    TEXT_FILES.map((name) => [name, new Uint8Array(readFileSync(join(FILES_DIR, name)))]),
  ) as TextFileBytes
  const model = await openNodeModel(new Uint8Array(readFileSync(join(FILES_DIR, 'text-model.onnx'))))
  return { files: readTextFiles(bytes), model }
}
