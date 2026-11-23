import { configDefaults, defineConfig } from 'vitest/config'

import preset from '@dazbee/config/vitest'

/** The speed checks, which time work and so run alone, after every other test (`vitest.speed.config.js`). */
export const SPEED_CHECKS = [
  'src/extrusion-speed.test.ts',
  'src/flow-drag-speed.test.ts',
  'src/frame-resize-speed.test.ts',
]

// Whole designs render here, a few seconds each on a slow CI runner.
export default defineConfig({
  ...preset,
  test: { ...preset.test, exclude: [...configDefaults.exclude, ...SPEED_CHECKS], testTimeout: 30_000 },
})
