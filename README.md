# Dazbee

## Develop

Needs Node 22.18 or later (CI, docker compose and the production images run Node 26) and pnpm 12 (`npm install -g pnpm@12`).

```sh
pnpm install
pnpm dev --filter @dazbee/web   # http://localhost:3000
pnpm lint        # dependency direction + ESLint
pnpm typecheck
pnpm test        # Vitest
```

## Layout

```
apps/web/             Next.js app: sign-in, brands, designs, brand kit, asset library, font catalog, templates, settings and the editor's UI
apps/api/             Hono API: workspace records, uploads, sign-in, sync tokens and server renders; runs the migrations (ADR-0009, ADR-0012)
apps/sync/            the sync server: holds each open design, orders its changes and stores its saves and journal (ADR-0015)
apps/landing/         the marketing site at dazbee.com, with its privacy and terms pages: a static Vite page, uploaded to Cloudflare Pages by hand
packages/schema/      the zod contract for the design document and the API (ADR-0002)
packages/doc/         the design's store, the commands that change it and the sync core (ADR-0004, ADR-0015)
packages/canvaskit/   our CanvasKit build, loaded by every runtime (ADR-0005)
packages/renderer/    lays out and draws a design with CanvasKit
packages/editor/      the client-only editor: canvas, tools, gestures, sync and offline copy
packages/export/      PNG, JPG, PDF and SVG exports, and their zips (ADR-0005); a frame drawn for an agent, and the warnings it is told
packages/svg/         turns an SVG file into layers
packages/fonts/       the font files we ship, the Google font catalog list and their Node loader
packages/db/          Drizzle tables and migrations (ADR-0009)
packages/storage/     object storage over the S3 API (ADR-0010)
packages/sync-token/  tokens the API signs for the sync server
packages/session-token/ the session tokens the API signs at sign-in, which the web app keeps in a cookie
packages/config/      shared tsconfig, ESLint and Vitest presets; the dependency-direction and no-Yjs checks
deploy/               production: the compose file, Caddyfiles and settings the server runs the images with, deploy.sh, which puts a commit live, setup.sh, which sets up the server, and backup.sh and restore.sh, which back the database up each night and restore it; each app's Dockerfile builds its image
tests/pixels/         Vitest checks: exports against reference renders, the gesture matrix's rows run in Node on the test editor, and speed checks that pnpm test runs alone after the rest (test:speed)
tests/deploy/         the deploy check CI runs: deploy.sh swaps the production stack's apps while a probe asks them every 100 ms and holds a tab open; and the backup check: a backup taken while rows are written restores with its counts
tools/load/           the load test: editors.ts ramps simulated people editing at once through the web app and sync server, from a developer's machine; setup.ts and clean.ts make and delete its workspace from inside the API's container
```

Packages only depend downward: schema → doc → renderer → editor, and never on an app. `pnpm lint:deps` enforces it (ADR-0001).

Inside each workspace, code is laid out by `docs/agents/code-layout.md`: feature folders, one order inside every file, and the imports each folder may make.
