# Build from the repository root: docker build -f apps/frontend/Dockerfile .
FROM node:22-slim AS build
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @growth-radar/frontend build

FROM node:22-slim AS runtime
ENV NODE_ENV=production
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /repo
COPY --from=build /repo /repo
WORKDIR /repo/apps/frontend
USER node
EXPOSE 3000
CMD ["pnpm", "start"]
