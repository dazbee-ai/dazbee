import { defineConfig } from 'vitest/config'

// `@/` is the app's root, as in tsconfig.json's paths.
export default defineConfig({
  resolve: { alias: { '@': import.meta.dirname } },
  test: {
    include: ['*.test.ts', 'app/**/*.test.ts', 'components/**/*.test.ts', 'lib/**/*.test.ts', 'scripts/**/*.test.ts'],
  },
})
