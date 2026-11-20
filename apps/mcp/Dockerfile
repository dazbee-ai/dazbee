# syntax=docker/dockerfile:1
# The MCP server's image: Node runs the TypeScript sources. Node strips types only outside
# node_modules, so the image keeps the workspace's layout, where pnpm links each @dazbee package to packages/*/src.
# Build from the repo's root: docker build -f apps/mcp/Dockerfile --build-arg BUILD_ID=<commit> .

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
    pnpm install --frozen-lockfile --prod --filter @dazbee/mcp...

FROM base AS sources
COPY --from=install /repo ./
COPY packages packages
COPY apps/mcp apps/mcp

FROM base
LABEL org.opencontainers.image.source=https://github.com/dazbee-ai/dazbee
COPY --from=sources /repo ./
ENV NODE_ENV=production PORT=3100
EXPOSE 3100
USER node
HEALTHCHECK --interval=30s --start-period=60s --start-interval=1s --timeout=3s --retries=3 \
  CMD ["node", "-e", "fetch('http://localhost:3100/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "apps/mcp/src/main.ts"]
# The commit this image is built from. Last, so a new commit rebuilds only this.
ARG BUILD_ID=dev
ENV BUILD_ID=$BUILD_ID
