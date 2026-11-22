import { defineConfig } from 'vitest/config'

import preset from '@dazbee/config/vitest'

// The scripts' tests run too: the fetch script's checks what CI downloads before the tests.
export default defineConfig({
  ...preset,
  test: { ...preset.test, include: [...preset.test.include, 'scripts/**/*.test.ts'] },
})
