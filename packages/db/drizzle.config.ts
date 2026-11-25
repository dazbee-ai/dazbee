import { defineConfig } from 'drizzle-kit'

// `pnpm --filter @dazbee/db migration <name>` writes the next migration from the `*tables.ts` files and the migrations
// before it. Never edit a merged migration.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/*tables.ts',
  out: './migrations',
})
