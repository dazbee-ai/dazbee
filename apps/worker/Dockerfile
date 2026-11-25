# syntax=docker/dockerfile:1
# The worker's image: Node runs the TypeScript sources. Node strips types only outside node_modules, so
# the image keeps the workspace's layout, where pnpm links each @dazbee package to packages/*/src.
# Build from the repo's root: docker build -f apps/worker/Dockerfile --build-arg BUILD_ID=<commit> .

FROM node:26.13.0-slim AS base
WORKDIR /repo

# The workspace's manifests and lockfile, and the CanvasKit package its install fetches the build
# into, so the install below is rebuilt only when one of them changes.
FROM base AS manifests
COPY . .
RUN find . -path ./packages/canvaskit -prune -o -type f \
      ! -name package.json ! -name pnpm-lock.yaml ! -name pnpm-workspace.yaml -exec rm {} +

FROM base AS install
COPY --from=manifests /repo ./
RUN npm install -g "pnpm@$(node -p "require('./package.json').packageManager.split('@')[1]")" && \
    pnpm install --frozen-lockfile --prod --filter @dazbee/worker...

FROM base AS sources
COPY --from=install /repo ./
COPY packages packages
# The bundled icons' and stickers' drawings (packages/graphics/sets) are the MCP server's alone.
RUN rm -r packages/graphics/sets
COPY apps/worker apps/worker

FROM base
LABEL org.opencontainers.image.source=https://github.com/dazbee-ai/dazbee
COPY --from=sources /repo ./
ENV NODE_ENV=production WORKER_PORT=8790
EXPOSE 8790
USER node
HEALTHCHECK --interval=30s --start-period=60s --start-interval=1s --timeout=3s --retries=3 \
  CMD ["node", "-e", "fetch('http://localhost:8790/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "apps/worker/src/main.ts"]
# The commit this image is built from, which /health names. Last, so a new commit rebuilds only this.
ARG BUILD_ID=dev
ENV BUILD_ID=$BUILD_ID
