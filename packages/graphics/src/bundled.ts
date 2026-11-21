// The bundled sets' files, read as JSON from `sets/`.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** The JSON file at `path` under `sets/`. */
export function readBundled(...path: string[]): unknown {
  return JSON.parse(readFileSync(join(import.meta.dirname, '..', 'sets', ...path), 'utf8'))
}
