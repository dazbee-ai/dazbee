// The globals a file of the editor's core may use, each with what the core uses it for. The core is
// compiled with no browser's and no Node's types (tsconfig.core.json), so a global that is not here
// does not compile in a core file: adding one is a decision a review sees. Each is declared with
// only what the core calls; a browser and Node both have them all.

/**
 * The core's end: its caller aborts the signal it was opened with, and work that arrives later is
 * dropped; and a session's end, which fails a confirmation still waited for as ended (the doc's
 * session and client store), whose listener is let go once the server answers.
 */
interface AbortSignal {
  readonly aborted: boolean
  addEventListener(type: 'abort', listener: () => void): void
  removeEventListener(type: 'abort', listener: () => void): void
}
/** What a session aborts as it is destroyed (the doc's session). */
declare class AbortController {
  readonly signal: AbortSignal
  abort(): void
}

/** A thumbnail's PNG bytes, which `URL.createObjectURL` gives an address (canvas/thumbnails). */
interface Blob {
  readonly type: string
}
declare const Blob: new (parts: Uint8Array<ArrayBuffer>[], options?: { type?: string }) => Blob

/** The addresses of the thumbnails' pictures, made and let go (canvas/thumbnails). */
declare const URL: {
  createObjectURL(blob: Blob): string
  revokeObjectURL(url: string): void
}

/** The log a fault's command and cause are written to (faults). */
declare const console: {
  error(...data: unknown[]): void
}

/** The time a redraw took and when it ended (canvas/redraw). */
declare const performance: {
  readonly timeOrigin: number
  now(): number
}

/** A PDF's or an SVG's bytes as text, to give the ids in it the same names on every run (the renderer's seam). */
declare class TextDecoder {
  decode(input: Uint8Array): string
}

/** That text as bytes again (the renderer's seam). */
declare class TextEncoder {
  encode(input: string): Uint8Array<ArrayBuffer>
}

/** The bytes of a picture an SVG file embeds as base64, to place it (the SVG converter's pictures). */
declare function atob(data: string): string
