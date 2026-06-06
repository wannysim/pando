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

# Worker CLI strategy: host-mounted, NOT baked into the image.
#
# The daemon/API/dashboard run from this image, but the SPEC->...->PR pipeline
# shells out to the `claude` / `codex` worker CLIs. We deliberately do NOT install
# those CLIs in this layer:
#   1. Auth cannot be baked. Both CLIs authenticate through managed-connector
#      tokens / config stored in ~/.claude and ~/.codex on the host. The image
#      would still need those host volumes mounted, so baking the binary alone
#      buys nothing runnable.
#   2. No secrets in the image (CLAUDE.md rule 5 + deploy security): API keys and
#      connector tokens stay on the host and are bind-mounted read-only at runtime.
#   3. Version parity. The host already runs tested CLI versions (handoff records
#      claude 2.1.167, codex-cli 0.137.0); mounting the host CLIs avoids drift
#      between "what was tested" and "what shipped".
#
# Two ways to put the CLIs in the container (auth still comes from host volumes):
#   A. Bind-mount the host CLI bin onto PATH via PANDO_WORKER_BIN (/worker-bin).
#      ONLY works when host and container share OS+arch. Verified here that a
#      macOS arm64 host CANNOT use this: ~/.local/bin/{claude,codex} are Mach-O
#      arm64 binaries, so the linux/arm64 container still reports the CLI missing
#      (readiness evidence: workerCli.pass=false). Use A on a Linux host only.
#   B. Install the Linux CLI in the image (recommended for a macOS host). Add an
#      install layer in this runtime stage, e.g.
#         RUN npm install -g @anthropic-ai/claude-code @openai/codex
#      and mount only the auth volumes. Trades version pinning + image size for a
#      self-contained, cross-platform image.
# Either way the auth volumes (~/.claude, ~/.codex) must be mounted; see
# deploy/docker-compose.yml and deploy/README.md "Worker readiness".
ENV PANDO_WORKER_BIN=/worker-bin
ENV PATH="/worker-bin:${PATH}"

RUN corepack enable
COPY --from=build /app /app

EXPOSE 3210
CMD ["pnpm", "start"]
