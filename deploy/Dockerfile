# syntax=docker/dockerfile:1

FROM oven/bun:1.3.5 AS deps
WORKDIR /app

COPY package.json bun.lock ./
COPY dashboard/package.json dashboard/package.json
RUN bun install --frozen-lockfile

FROM deps AS build
COPY . .
RUN bun --filter=@pando/dashboard run build
RUN bun run types

FROM oven/bun:1.3.5 AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PANDO_HOST=0.0.0.0
ENV PANDO_PORT=3210
ENV PANDO_DB=/data/pando.sqlite
ENV PANDO_STATIC_DASHBOARD_ROOT=/app/dashboard/dist

# Worker CLI strategy: secret-free base image, opt-in worker CLI layer.
#
# The daemon/API/dashboard run from this image, but the default SPEC->...->PR
# pipeline shells out to the `codex` worker CLI. `claude` remains optional for
# legacy/custom profiles. We deliberately do NOT install worker CLIs by default:
#   1. Auth cannot be baked. Codex uses OPENAI_API_KEY or writable CODEX_HOME;
#      Claude profiles use Anthropic/Claude runtime credentials. Baking binaries
#      alone buys nothing runnable.
#   2. No secrets in the image (CLAUDE.md rule 5 + deploy security): API keys and
#      connector tokens stay on the host and are bind-mounted read-only at runtime.
#   3. Version parity. The host already runs tested CLI versions (handoff records
#      claude 2.1.167, codex-cli 0.137.0); mounting the host CLI avoids drift
#      between "what was tested" and "what shipped".
#
# Two ways to put the CLIs in the container (auth still comes from host/env):
#   A. Bind-mount the host CLI bin onto PATH via PANDO_WORKER_BIN (/worker-bin).
#      ONLY works when host and container share OS+arch. Verified that a macOS
#      arm64 host CANNOT use this: ~/.local/bin/{claude,codex} are Mach-O arm64
#      binaries, so the linux/arm64 container still reports the CLI missing
#      (readiness evidence: workerCli.pass=false). Use A on a Linux host only.
#   B. Install the Linux CLI in the image (recommended for a macOS host). This is
#      the opt-in, version-pinned layer below. Build with
#         --build-arg INSTALL_WORKER_CLIS=true
#      (compose: PANDO_INSTALL_WORKER_CLIS=true). Versions are pinned via build
#      args so "what shipped" matches "what was tested" (handoff: claude 2.1.167,
#      codex-cli 0.137.0). Verified 2026-06-07: this layer makes Codex available
#      for docker readiness; auth still needs OPENAI_API_KEY or usable runtime
#      credentials.
# Either way auth must come from API keys or mounted runtime credentials; never
# bake secrets into the image. See deploy/docker-compose.yml and deploy/README.md
# "Worker readiness". The runtime also includes ca-certificates/git/ssh because
# live worker calls and PR-stage git operations need them.
ENV PANDO_WORKER_BIN=/worker-bin
ENV PATH="/worker-bin:${PATH}"

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      ca-certificates \
      git \
      openssh-client \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build /app /app

# Opt-in worker CLI install (option B). Default false keeps the base image lean
# and secret-free (auth still comes from mounted volumes, never baked here).
ARG INSTALL_WORKER_CLIS=false
ARG CLAUDE_CLI_VERSION=2.1.167
ARG CODEX_CLI_VERSION=0.137.0
RUN if [ "${INSTALL_WORKER_CLIS}" = "true" ]; then \
      bun install --global \
        @anthropic-ai/claude-code@"${CLAUDE_CLI_VERSION}" \
        @openai/codex@"${CODEX_CLI_VERSION}"; \
    fi

EXPOSE 3210
CMD ["bun", "run", "start"]
