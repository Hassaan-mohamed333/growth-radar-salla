# Build from the repository root: docker build -f apps/backend/Dockerfile .
FROM node:22-slim AS build
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @growth-radar/database build && pnpm --filter @growth-radar/backend build

FROM node:22-slim AS runtime
ENV NODE_ENV=production
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /repo
COPY --from=build /repo /repo
WORKDIR /repo/apps/backend
USER node
EXPOSE 4000
# Migrations are a separate, explicit step (pnpm db:migrate / prisma migrate deploy), never run on boot.
CMD ["node", "dist/main.js"]
