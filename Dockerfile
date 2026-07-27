# -- Common base with runtime deps ------------------------------------------
FROM node:24-trixie-slim AS base
WORKDIR /app

# `apt-get upgrade` pulls security-patched trixie base-image packages at build time
# (clears the subset of container-scan CVEs that already have a fix published in trixie).
# CVEs without an upstream fix remain until the distro patches them and the image is rebuilt.
RUN --mount=type=cache,target=/var/cache/apt,sharing=shared   --mount=type=cache,target=/var/lib/apt/lists,sharing=shared   apt-get update   && apt-get upgrade -y   && apt-get install -y --no-install-recommends libsecret-1-0 ca-certificates   && rm -rf /var/lib/apt/lists/*

# Refresh the globally-installed npm so its bundled node_modules (undici, tar) ship the
# patched versions — container scanner flags the stale copies under npm's own internals.
RUN npm install -g npm@11.18.0   && npm cache clean --force

# -- Builder ----------------------------------------------------------------
FROM base AS builder

# Build tools for native module compilation
# apt-get update needed here because base's rm -rf clears the shared cache
RUN --mount=type=cache,target=/var/cache/apt,sharing=shared   --mount=type=cache,target=/var/lib/apt/lists,sharing=shared   apt-get update   && apt-get install -y --no-install-recommends python3 make g++   && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
# Workspace package manifests MUST be present before `npm ci` so npm materializes the
# workspace and installs its workspace-only deps (e.g. safe-regex, @toon-format/toon —
# declared in open-sse/package.json, not hoisted to root). Without this, `npm ci` skips
# them and the build fails with "Module not found" (root cause of the v3.8.39 Docker
# build break). workspaces = ["open-sse"].
COPY open-sse/package.json ./open-sse/package.json
COPY scripts/build/postinstall.mjs ./scripts/build/postinstall.mjs
COPY scripts/build/postinstallSupport.mjs ./scripts/build/postinstallSupport.mjs
COPY scripts/build/native-binary-compat.mjs ./scripts/build/native-binary-compat.mjs
ENV NPM_CONFIG_LEGACY_PEER_DEPS=true
# --ignore-scripts blocks broad dependency install/postinstall hooks, closing
# the supply-chain attack surface where a transitive dep can run arbitrary code
# at install time. better-sqlite3 still needs a native binding for the target
# platform, so rebuild and smoke-test only that known runtime dependency below.
#
# We REQUIRE a committed package-lock.json so resolved dependency versions
# are reproducible.
RUN test -f package-lock.json   || (echo "package-lock.json is required for reproducible Docker builds" >&2 && exit 1)
# Invoke node-gyp directly inside node_modules/better-sqlite3 to compile
# better_sqlite3.node against the builder's exact Node ABI (node-v137 / Node 24)
# instead of pulling a prebuilt binary whose layout (prebuilds/) the standalone
# assembler does not copy. Bypassing `npm rebuild` indirection is deterministic
# regardless of npm version or ignore-scripts allowlist behavior (#6700). This
# guarantees build/Release/better_sqlite3.node exists so `bindings('better_sqlite3.node')`
# resolves it at runtime (bootstrap-env's hasEncryptedCredentials needs SQLite
# before the server starts).
# node-gyp comes from npm's own bundled copy (deterministic, already in the image)
# instead of `npx --yes`, which would install an arbitrary registry version
# on-demand and run its lifecycle scripts (Sonar docker:S6505).
RUN --mount=type=cache,id=npm-cache,target=/root/.npm \
  npm ci --no-audit --no-fund --legacy-peer-deps --ignore-scripts \
  && (cd node_modules/better-sqlite3 \
      && node /usr/local/lib/node_modules/npm/node_modules/node-gyp/bin/node-gyp.js rebuild) \
  && node -e "require('better-sqlite3')(':memory:').close()" \
  && node node_modules/tls-client-node/scripts/postinstall.js \
  && (test -n "$(find node_modules/tls-client-node/bin -mindepth 1 -print -quit 2>/dev/null)" \
      || (echo "tls-client-node native binary missing after postinstall" >&2 && exit 1))

# Build with webpack (stable). Turbopack hit a non-recoverable internal panic on this
# Next.js version during the v3.8.27 release build — TurbopackInternalError in
# ImportTracer::get_traces. Webpack is the proven engine. Re-enable Turbopack (=1) once
# the upstream tracer bug is fixed.
ENV OMNIROUTE_USE_TURBOPACK=0

# Docker cannot provide the host DNS/certificate access required by MITM/Agent Bridge.
ENV OMNIROUTE_MITM_STUB=1

# Raise the V8 heap ceiling for the build. The webpack production optimization pass needs
# more than V8's default ceiling (~2 GB) for a codebase this size; a memory-constrained
# Docker build otherwise dies with "JavaScript heap out of memory" (#4076). Build-only;
# the runtime heap is set separately on the runner stage (OMNIROUTE_MEMORY_MB).
# Override for hosts with more/less RAM: `--build-arg OMNIROUTE_BUILD_MEMORY_MB=8192`.
# Default raised from 4096 -> 8192 after the v3.8.49 zeabur build OOM'd on the fork's
# merged codebase (run 29724097623); GitHub Actions ubuntu-latest runners have 16 GB.
ARG OMNIROUTE_BUILD_MEMORY_MB=8192
ENV NODE_OPTIONS="--max-old-space-size=${OMNIROUTE_BUILD_MEMORY_MB}"

COPY . ./
RUN --mount=type=cache,target=/app/.build/next/cache   mkdir -p /app/data && npm run build

# -- Runner base ------------------------------------------------------------
FROM base AS runner-base

LABEL org.opencontainers.image.title="omniroute"   org.opencontainers.image.description="Unified AI proxy -- route any LLM through one endpoint"   org.opencontainers.image.url="https://omniroute.online"   org.opencontainers.image.source="https://github.com/diegosouzapw/OmniRoute"   org.opencontainers.image.licenses="MIT"

ENV NODE_ENV=production
ENV PORT=20128
ENV HOSTNAME=0.0.0.0
# Runtime heap ceiling. 1024MB is enough for normal traffic but can be tight
# for large fusion-combo panels (many models fanned out in parallel, each
# response buffered in full — see open-sse/services/fusion.ts::FUSION_DEFAULTS
# .maxPanel, issue #1905). Override at `docker run` time with
# `-e OMNIROUTE_MEMORY_MB=2048` (or higher) if you raise fusionTuning.maxPanel
# above the default cap.
ENV OMNIROUTE_MEMORY_MB=1024
ENV NODE_OPTIONS="--max-old-space-size=${OMNIROUTE_MEMORY_MB}"

# Zeabur production data directory; docker-compose.prod.yml mounts this path.
ENV DATA_DIR=/var/lib/omniroute

# The standalone build + syncStandaloneExtraModules bundles all runtime files
# (.next, node_modules, migrations, scripts, docs, etc.) into .build/next/standalone/.
# Explicit overrides below cover modules that NFT tracing may miss.
COPY --from=builder /app/.build/next/standalone ./
# Explicitly copy @swc/helpers -- not always traced by standalone output but needed at runtime
COPY --from=builder /app/node_modules/@swc/helpers ./node_modules/@swc/helpers
# Explicitly copy better-sqlite3 -- native bindings are not reliably traced by
# Next.js standalone output, but bootstrap-env requires SQLite before startup.
COPY --from=builder /app/node_modules/better-sqlite3 ./node_modules/better-sqlite3
# Explicitly copy pino transport dependencies -- pino spawns a worker that requires
# pino-abstract-transport at runtime; Next.js standalone trace does not capture it (#449)
COPY --from=builder /app/node_modules/pino-abstract-transport ./node_modules/pino-abstract-transport
COPY --from=builder /app/node_modules/pino-pretty ./node_modules/pino-pretty
COPY --from=builder /app/node_modules/split2 ./node_modules/split2
# Migration SQL files are read via fs.readFileSync at runtime and are NOT
# traced by Next.js standalone output -- copy them explicitly.
COPY --from=builder /app/src/lib/db/migrations ./migrations
ENV OMNIROUTE_MIGRATIONS_DIR=/app/migrations

# Healthcheck is not guaranteed to be traced into the standalone output.
COPY --from=builder /app/scripts/dev/healthcheck.mjs ./healthcheck.mjs

# Hand runtime paths to the baked-in `node` non-root user (UID/GID 1000) so the
# app and mounted Zeabur data directory are writable without running as root.
RUN mkdir -p /var/lib/omniroute   && chown -R node:node /app /var/lib/omniroute

EXPOSE 20128

# Drop to non-root before ENTRYPOINT/CMD so every derived stage (runner-cli,
# runner-web) also runs as a non-root user unless they explicitly switch back.
USER node

# Warns if the mounted data volume has wrong ownership
COPY --chmod=755 scripts/check-permissions.sh /tmp/check-permissions.sh
ENTRYPOINT ["/tmp/check-permissions.sh"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3   CMD ["node", "healthcheck.mjs"]

CMD ["node", "dev/run-standalone.mjs"]

# -- Runner Web (web-cookie providers: Gemini Web, Claude Turnstile) ----------
#
#  Two image flavors:
#    runner-base  ->  omniroute:VERSION        Lean base (~500 MB). No browsers.
#    runner-web   ->  omniroute:VERSION-web    +Chromium/Playwright (~800 MB).
#
#  Use runner-web when you need web-cookie providers (gemini-web, claude-web,
#  claude-turnstile). For all other providers runner-base is sufficient.
#
#  Build:
#    docker build --target runner-web -t omniroute:web .
#  Compose:
#    build:
#      context: .
#      target: runner-web
FROM runner-base AS runner-web

USER root

COPY --from=builder /app/node_modules/playwright-core ./node_modules/playwright-core
COPY --from=builder /app/node_modules/playwright ./node_modules/playwright

# Install Playwright browser binaries + OS dependencies under root, then hand
# ownership of the browsers cache to the node user.
# PLAYWRIGHT_BROWSERS_PATH overrides the default ~/.cache/ms-playwright so the
# browsers land under /home/node which persists across image layers and is
# accessible to the non-root runtime user.
ENV PLAYWRIGHT_BROWSERS_PATH=/home/node/.cache/ms-playwright
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
  --mount=type=cache,target=/var/lib/apt/lists,sharing=locked \
  apt-get update \
  && node node_modules/playwright/cli.js install chromium --with-deps \
  && chown -R node:node /home/node/.cache \
  && rm -rf /var/lib/apt/lists/*

USER node

FROM runner-base AS runner-cli

# Install CLI tools as root, then return to the `node` non-root runtime user.
USER root
ARG TARGETARCH
ARG AGY_VERSION="1.0.4"

# Install system dependencies required by CLI agents (git+ssh references, Docker access,
# Python for Python-based tools).
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked   --mount=type=cache,target=/var/lib/apt/lists,sharing=locked   apt-get update   && apt-get install -y --no-install-recommends git ca-certificates curl docker.io docker-compose python3 python3-pip   && rm -rf /var/lib/apt/lists/*   && git config --system url."https://github.com/".insteadOf "ssh://git@github.com/"

# Install AI CLI agents globally with graceful fallbacks for tools that may not be on npm/pip.
RUN --mount=type=cache,target=/root/.npm   npm install -g --no-audit --no-fund @anthropic-ai/claude-code@latest 2>/dev/null || echo "claude-code installation skipped"
RUN --mount=type=cache,target=/root/.npm   npm install -g --no-audit --no-fund cursor-cli@latest 2>/dev/null || echo "cursor-cli installation skipped"
RUN --mount=type=cache,target=/root/.npm   npm install -g --no-audit --no-fund @google/generative-ai@latest 2>/dev/null || echo "gemini-cli installation skipped"
RUN --mount=type=cache,target=/root/.npm   npm install -g --no-audit --no-fund @openai/codex@0.144.1 2>/dev/null || echo "codex installation skipped"
RUN pip3 install --no-cache-dir --break-system-packages kimi-cli 2>/dev/null || echo "kimi-cli installation skipped"
RUN --mount=type=cache,target=/root/.npm   npm install -g --no-audit --no-fund openclaw@latest 2>/dev/null || echo "openclaw installation skipped"
RUN --mount=type=cache,target=/root/.npm   npm install -g --no-audit --no-fund droid@latest 2>/dev/null || echo "droid installation skipped"
RUN --mount=type=cache,target=/root/.npm   npm install -g --no-audit --no-fund @kilocode/cli@latest 2>/dev/null || echo "kilo-cli installation skipped"
RUN set -eu; \
  case "${TARGETARCH}" in \
    amd64) AGY_ARCH="linux_x64" ;; \
    arm64) AGY_ARCH="linux_arm64" ;; \
    *) echo "unsupported TARGETARCH for agy: ${TARGETARCH}" >&2; exit 1 ;; \
  esac; \
  AGY_URL="https://github.com/google-antigravity/antigravity-cli/releases/download/${AGY_VERSION}/agy_cli_${AGY_ARCH}.tar.gz"; \
  TMP_DIR="$(mktemp -d)"; \
  (curl -fsSL "${AGY_URL}" -o "${TMP_DIR}/agy.tar.gz" \
    && tar -xzf "${TMP_DIR}/agy.tar.gz" -C "${TMP_DIR}" agy \
    && install -m 755 "${TMP_DIR}/agy" /usr/local/bin/agy) \
    || echo "agy install skipped"; \
  rm -rf "${TMP_DIR}"

# Create persistent home directory structure for CLI configs and cache.
RUN mkdir -p /root/.config /root/.cache /root/.local/share /root/.ssh && chmod 700 /root/.ssh

USER node
