// A test's own AI function, declared the same way in the test's process and in the worker process it starts to
// crash. Imported by tests only.
import { AI_FUNCTION_DEFS } from '@dazbee/ai'

/** The name of the one preset a test's AI function has. */
export const TEST_PRESET = 'test'

/** The model a test's AI function runs: its name with `function` put as `model`, so another process finds it too. */
export const testModelOf = (fn: string) => fn.replace('test-function-', 'test-model-')

/** Declares the test-only text function `fn`, whose one preset runs its test model. */
export function declareTestFunction(fn: string): void {
  AI_FUNCTION_DEFS[fn] = {
    kind: 'text',
    presets: { [TEST_PRESET]: { model: testModelOf(fn), settings: {}, guess: { cost: 100_000n, seconds: 5 } } },
  }
}
