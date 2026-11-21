import { defineConfig } from 'vitest/config'

import preset from '@dazbee/config/vitest'

// The developer scripts' tests run beside the package's own.
export default defineConfig({
  ...preset,
  test: { ...preset.test, include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'] },
})
