// The font fingerprint's model run by onnxruntime-node on one CPU thread, for Node: the tests and the
// measurement scripts. Its own export, so nothing that runs in a browser imports
// onnxruntime-node, which only the packages that run it in Node depend on.

import * as ort from 'onnxruntime-node'

import { MODEL_INPUT, MODEL_OUTPUT, type ModelRuntime, WINDOW_HEIGHT, WINDOW_WIDTH } from './model-runtime.ts'

/** A model runtime that holds an open session until it is released. */
export interface NodeModelRuntime extends ModelRuntime {
  release(): Promise<void>
}

/** Opens the model's bytes (`text-model.onnx`) in onnxruntime-node, on one thread, run in order. */
export async function openNodeModel(model: Uint8Array): Promise<NodeModelRuntime> {
  const session = await ort.InferenceSession.create(model, {
    intraOpNumThreads: 1,
    interOpNumThreads: 1,
    executionMode: 'sequential',
    graphOptimizationLevel: 'all',
  })
  return {
    async run(windows, count) {
      const input = new ort.Tensor('float32', windows, [count, 1, WINDOW_HEIGHT, WINDOW_WIDTH])
      const output = (await session.run({ [MODEL_INPUT]: input }))[MODEL_OUTPUT]
      if (!output) throw new Error(`the model gave no ${MODEL_OUTPUT}`)
      return output.data as Float32Array
    },
    release: () => session.release(),
  }
}
