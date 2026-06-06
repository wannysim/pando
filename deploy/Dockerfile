# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY dashboard/package.json dashboard/package.json
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm --filter @pando/dashboard build
RUN pnpm types

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PANDO_HOST=0.0.0.0
ENV PANDO_PORT=3210
ENV PANDO_DB=/data/pando.sqlite
ENV PANDO_STATIC_DASHBOARD_ROOT=/app/dashboard/dist

RUN corepack enable
COPY --from=build /app /app

EXPOSE 3210
CMD ["pnpm", "start"]
