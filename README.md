# Dazbee

## Develop

Needs Node 22.18 or later (CI, docker compose and the production images run Node 26) and pnpm 12 (`npm install -g pnpm@12`).

```sh
pnpm install
pnpm dev --filter @dazbee/web   # http://localhost:3000
pnpm dev --filter @dazbee/mcp   # the MCP server: http://localhost:3100/mcp
pnpm lint        # dependency direction + ESLint
pnpm typecheck
pnpm test        # Vitest
```

The MCP server runs on the host beside the web app and reaches the API and the sync server at their local ports (`API_URL`, `SYNC_URL` and `PUBLIC_URL` change them). Start the web app with `MCP_DEV_URL=http://localhost:3100` and it passes `/mcp`, `/oauth/*` and `/.well-known/oauth-*` on to the MCP server, and an agent's upload links, `/uploads/*`, to the API, so an agent connects to `http://localhost:3000/mcp`, one address for all, as Caddy serves them in production. Settings shows that address: the web app's `PUBLIC_URL` and `/mcp`, or with none set, `/mcp` on the host it was reached at.

The capacity limits are settings read from the environment when a server starts, each a whole number; unset or empty takes the default below, and a value out of range stops the server from starting. In production they are set in the server's `.env` (`deploy/env.example`, `deploy/compose.yml`).

| Setting                                         | Default | What it limits                                                                                            |
| ----------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------- |
| `MCP_AGENT_TABS`                                | 30      | agent tabs open at once in the MCP server                                                                 |
| `MCP_AGENT_TABS_PER_ACCESS`                     | 1       | agent tabs one agent access may have open; an MCP session opening one more takes over the access's oldest |
| `MCP_SESSIONS`                                  | 200     | MCP sessions in all                                                                                       |
| `MCP_SESSIONS_PER_ACCESS`                       | 4       | MCP sessions one access may hold; a new one ends the oldest                                               |
| `MCP_SESSION_IDLE_MINUTES`                      | 30      | how long an unused session lives                                                                          |
| `MCP_CALLS_BURST`, `MCP_CALLS_PER_SECOND`       | 60, 2   | each access's calls: so many at once, then so many each second                                            |
| `MCP_RENDERS_BURST`, `MCP_RENDER_EVERY_SECONDS` | 10, 6   | each access's renders: so many at once, then one every so many seconds                                    |
| `MCP_RENDERS_WAITING`                           | 8       | renders that may wait in the MCP server                                                                   |
| `MCP_DESIGNS_PER_HOUR`                          | 30      | new designs one access may make in an hour                                                                |
| `SYNC_LOADED_MB`                                | 200     | design bytes the sync server holds loaded at once, in MB                                                  |
| `SYNC_IDLE_DESIGNS`, `SYNC_IDLE_SECONDS`        | 50, 60  | designs the sync server keeps loaded with no tab, and for how many seconds                                |
| `AGENT_SIGN_INS_PER_HOUR`                       | 60      | agents' sign-ins the API takes from one address in an hour                                                |
| `AGENT_REGISTRATIONS_PER_HOUR`                  | 500     | agent client registrations the API takes in all in an hour                                                |

`PIXABAY_API_KEY`, the API's setting, is Pixabay's key: set, agents search Pixabay's free stock photos and save them into a brand's images (`search_stock`, `add_stock`); unset or empty, both say stock search is off. The API keeps each Pixabay answer 24 hours and sends Pixabay at most 100 requests a minute, as Pixabay's terms ask.

## Layout

```
apps/web/             Next.js app: sign-in, brands, designs, brand kit, asset library, font catalog, templates, settings and the editor's UI
apps/api/             Hono API: workspace records, uploads, sign-in, sync tokens and server renders; runs the migrations (ADR-0009, ADR-0012)
apps/mcp/             the MCP server agents connect to: OAuth sign-in, agent tabs and their tools (ADR-0019)
apps/sync/            the sync server: holds each open design, orders its changes and stores its saves and journal (ADR-0015)
apps/landing/         the marketing site at dazbee.com, with its privacy and terms pages: a static Vite page, uploaded to Cloudflare Pages by hand
packages/schema/      the zod contract for the design document and the API (ADR-0002)
packages/doc/         the design's store, the commands that change it and the sync core (ADR-0004, ADR-0015)
packages/canvaskit/   our CanvasKit build, loaded by every runtime (ADR-0005)
packages/renderer/    lays out and draws a design with CanvasKit
packages/editor/      the client-only editor: canvas, tools, gestures, sync and offline copy
packages/export/      PNG, JPG, PDF and SVG exports, and their zips (ADR-0005); a frame drawn for an agent, and the warnings it is told
packages/svg/         turns an SVG file into layers
packages/figma/       turns a Figma file's JSON into pages, frames and layers, with a report of what it left out or drew another way
packages/matchers/    the matchers' code (ADR-0020): the looks-the-same rule that judges a rebuild of a piece of a picture, the shape matcher, and the text matcher's reading, shortlist and Light
packages/graphics/    the icon sets agents place (Tabler and Phosphor) with their licences, their search index and the SVG each icon is placed as
packages/patterns/    the patterns agents build ads from (apply_pattern): each a pure function of the pattern, its style, the brand kit, the content and a size, giving a frame's layers
packages/fonts/       the font files we ship, the Google font catalog list and their Node loader
packages/db/          Drizzle tables and migrations (ADR-0009)
packages/storage/     object storage over the S3 API (ADR-0010)
packages/sync-token/  tokens the API signs for the sync server
packages/session-token/ the session tokens the API signs at sign-in, which the web app keeps in a cookie
packages/config/      shared tsconfig, ESLint and Vitest presets; the dependency-direction and no-Yjs checks
deploy/               production: the compose file, Caddyfiles and settings the server runs the images with, the MCP server's among them, deploy.sh, which puts a commit live, setup.sh, which sets up the server, and backup.sh and restore.sh, which back the database up each night and restore it; each app's Dockerfile builds its image
tests/pixels/         Vitest checks: exports against reference renders, every pattern in every style at every channel size with a clean design check, the gesture matrix's rows run in Node on the test editor, and speed checks that pnpm test runs alone after the rest (test:speed)
tests/deploy/         the deploy check CI runs: deploy.sh swaps the production stack's apps while a probe asks them every 100 ms and holds a tab open; and the backup check: a backup taken while rows are written restores with its counts
tools/load/           the load test: editors.ts ramps simulated people editing at once through the web app and sync server, from a developer's machine; setup.ts and clean.ts make and delete its workspace from inside the API's container
prototypes/agent-ads-runs/ the agents' ads briefs and run.py, which runs them with headless Claude Code through the MCP server and shows the designs (spec #123); not a workspace
```

Packages only depend downward: schema → doc → renderer → editor, and never on an app. `pnpm lint:deps` enforces it (ADR-0001).

Inside each workspace, code is laid out by `docs/agents/code-layout.md`: feature folders, one order inside every file, and the imports each folder may make.
