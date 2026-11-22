import { defineConfig } from 'vitest/config'

import preset from '@dazbee/config/vitest'

// The scripts' tests run too: the fetch script's is the one that checks what CI and the worker app download.
export default defineConfig({
  ...preset,
  test: { ...preset.test, include: [...preset.test.include, 'scripts/**/*.test.ts'] },
})
