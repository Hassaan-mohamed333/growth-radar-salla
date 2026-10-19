# Build from the repository root: docker build -f apps/frontend/Dockerfile .
FROM node:22-slim AS build
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
# The /api rewrite target is fixed when Next builds, so the backend address must be a BUILD arg:
#   docker build -f apps/frontend/Dockerfile --build-arg API_URL=https://api.example.com .
# Without it the build proxies /api to the default in next.config.mjs (and prints a warning).
ARG API_URL
ENV API_URL=${API_URL}
RUN pnpm --filter @growth-radar/frontend build

FROM node:22-slim AS runtime
ENV NODE_ENV=production
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /repo
COPY --from=build /repo /repo
WORKDIR /repo/apps/frontend
USER node
# At runtime also pass the same API_URL (docker run -e API_URL=...): server-rendered pages read it
# to call the backend directly.
EXPOSE 3000
# Run Next directly, like the backend image runs node: `pnpm start` would need pnpm available to
# the unprivileged user at runtime (corepack was prepared as root).
CMD ["node", "node_modules/next/dist/bin/next", "start", "-p", "3000"]
