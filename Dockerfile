FROM node:24.15.0-trixie-slim AS runner-base
WORKDIR /app

LABEL org.opencontainers.image.title="omniroute" \
  org.opencontainers.image.description="Unified AI proxy — route any LLM through one endpoint" \
  org.opencontainers.image.url="https://omniroute.online" \
  org.opencontainers.image.source="https://github.com/diegosouzapw/OmniRoute" \
  org.opencontainers.image.licenses="MIT"

ENV NODE_ENV=development
ENV PORT=20128
ENV HOSTNAME=0.0.0.0
ENV OMNIROUTE_MEMORY_MB=1024
ENV NODE_OPTIONS="--max-old-space-size=${OMNIROUTE_MEMORY_MB}"

# Data directory inside Docker — must match the volume mount in docker-compose.yml
ENV DATA_DIR=/var/lib/omniroute

# Install system dependencies
RUN apt-get update \
  && apt-get install -y --no-install-recommends libsecret-1-0 ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Build stage - install deps and build
COPY package*.json ./
COPY scripts/postinstall.mjs ./scripts/postinstall.mjs
COPY scripts/build/postinstall.mjs ./scripts/build/postinstall.mjs
COPY scripts/build/postinstallSupport.mjs ./scripts/build/postinstallSupport.mjs
COPY scripts/build/native-binary-compat.mjs ./scripts/build/native-binary-compat.mjs
ENV NPM_CONFIG_LEGACY_PEER_DEPS=true
RUN if [ -f package-lock.json ]; then npm ci --no-audit --no-fund --ignore-scripts; else npm install --no-audit --no-fund --ignore-scripts; fi

COPY . ./
RUN mkdir -p /var/lib/omniroute \
  && chown node:node /var/lib/omniroute \
  && NODE_OPTIONS=--max-old-space-size=4096 npm run build -- --webpack
ENV NODE_ENV=production

# Keep only runtime files
RUN mv public public.tmp && \
    mv .next/static static.tmp && \
    mv .next/standalone standalone.tmp && \
    rm -rf .next && \
    mkdir -p .next && \
    mv public.tmp public && \
    mv static.tmp .next/static && \
    mv standalone.tmp/* . && \
    rmdir standalone.tmp

# Explicitly keep runtime dependencies that Next.js standalone doesn't trace
# (already in node_modules from build, no COPY --from needed)

# Copy migrations explicitly (not traced by Next.js)
RUN cp -r src/lib/db/migrations ./migrations
ENV OMNIROUTE_MIGRATIONS_DIR=/app/migrations

EXPOSE 20128

# Drop to non-root before ENTRYPOINT/CMD so every derived stage (runner-cli,
# runner-web) also runs as a non-root user unless they explicitly switch back.
USER node

# Warns if the mounted data volume has wrong ownership
COPY --chmod=755 scripts/check-permissions.sh /tmp/check-permissions.sh
ENTRYPOINT ["/tmp/check-permissions.sh"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "scripts/dev/healthcheck.mjs"]

CMD ["node", "scripts/dev/run-standalone.mjs"]

# ── Runner Web (web-cookie providers: Gemini Web, Claude Turnstile) ───────────
#
#  Two image flavors:
#    runner-base  →  omniroute:VERSION        Lean base (~500 MB). No browsers.
#    runner-web   →  omniroute:VERSION-web    +Chromium/Playwright (~800 MB).
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

# Install Playwright browser binaries + OS dependencies under root, then hand
# ownership of the browsers cache to the node user.
# PLAYWRIGHT_BROWSERS_PATH overrides the default ~/.cache/ms-playwright so the
# browsers land under /home/node which persists across image layers and is
# accessible to the non-root runtime user.
ENV PLAYWRIGHT_BROWSERS_PATH=/home/node/.cache/ms-playwright
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
  --mount=type=cache,target=/var/lib/apt/lists,sharing=locked \
  apt-get update \
  && npx playwright install chromium --with-deps \
  && chown -R node:node /home/node/.cache \
  && rm -rf /var/lib/apt/lists/*

USER node

FROM runner-base AS runner-cli

USER root

# Install system dependencies required by CLI agents (git+ssh references, Python for some tools).
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates docker.io docker-compose python3 python3-pip \
  && rm -rf /var/lib/apt/lists/* \
  && git config --system url."https://github.com/".insteadOf "ssh://git@github.com/"

# Install AI CLI agents globally with graceful fallbacks for tools that may not be on npm/pip.
# Claude CLI
RUN npm install -g --no-audit --no-fund @anthropic-ai/claude-code@latest 2>/dev/null || echo "claude-code installation skipped"
# Cursor CLI
RUN npm install -g --no-audit --no-fund cursor-cli@latest 2>/dev/null || echo "cursor-cli installation skipped"
# Gemini CLI
RUN npm install -g --no-audit --no-fund @google/generative-ai@latest 2>/dev/null || echo "gemini-cli installation skipped"
# Codex CLI
RUN npm install -g --no-audit --no-fund @openai/codex@latest 2>/dev/null || echo "codex installation skipped"
# Kimi CLI (Python-based)
RUN pip3 install --no-cache-dir --break-system-packages kimi-cli 2>/dev/null || echo "kimi-cli installation skipped"
# OpenClaw agent
RUN npm install -g --no-audit --no-fund openclaw@latest 2>/dev/null || echo "openclaw installation skipped"
# Droid CLI
RUN npm install -g --no-audit --no-fund droid@latest 2>/dev/null || echo "droid installation skipped"
# Kilo CLI
RUN npm install -g --no-audit --no-fund @kilocode/cli@latest 2>/dev/null || echo "kilo-cli installation skipped"

# Create persistent home directory structure for CLI configs and cache
RUN mkdir -p /root/.config /root/.cache /root/.local/share /root/.ssh && chmod 700 /root/.ssh

USER node
