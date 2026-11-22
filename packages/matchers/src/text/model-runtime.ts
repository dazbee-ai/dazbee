// The font fingerprint's model as the text matcher runs it: windows of ink in, the model's numbers
// out. The caller gives the runtime, so Node runs the model with onnxruntime-node
// (`model-runtime-node.ts`) and a browser with ONNX Runtime Web, on WebAssembly only (ADR-0020).

/** Runs the model on windows of ink. */
export interface ModelRuntime {
  /**
   * The model's `MODEL_NUMBERS` numbers for each of `count` windows: `windows` holds them one after
   * another, `WINDOW_HEIGHT` rows of `WINDOW_WIDTH` ink values, 0 to 1, each.
   */
  run(windows: Float32Array, count: number): Promise<Float32Array>
}

/** A window's height in pixels: a line's strip is this tall. */
export const WINDOW_HEIGHT = 64
/** A window's width in pixels: a strip is read in windows this wide, overlapping by half. */
export const WINDOW_WIDTH = 256
/** How many numbers the model gives a window. */
export const MODEL_NUMBERS = 512
/** The model's input, windows shaped count × 1 × `WINDOW_HEIGHT` × `WINDOW_WIDTH`. */
export const MODEL_INPUT = 'ink'
/** The model's output, `MODEL_NUMBERS` a window. */
export const MODEL_OUTPUT = 'fingerprint'
