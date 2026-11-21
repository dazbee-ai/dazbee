// The bundled sets' files, read from `sets/`: JSON, or a file's bytes.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** The JSON file at `path` under `sets/`. */
export function readBundled(...path: string[]): unknown {
  return JSON.parse(readFileSync(join(import.meta.dirname, '..', 'sets', ...path), 'utf8'))
}

/** The bytes of the file at `path` under `sets/`. */
export function readBundledBytes(...path: string[]): Uint8Array {
  return new Uint8Array(readFileSync(join(import.meta.dirname, '..', 'sets', ...path)))
}
