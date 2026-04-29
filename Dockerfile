FROM node:24.15.0-trixie-slim AS builder
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends libsecret-1-0 ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
COPY scripts/postinstall.mjs ./scripts/postinstall.mjs
COPY scripts/postinstallSupport.mjs ./scripts/postinstallSupport.mjs
COPY scripts/native-binary-compat.mjs ./scripts/native-binary-compat.mjs
ENV NPM_CONFIG_LEGACY_PEER_DEPS=true
RUN if [ -f package-lock.json ]; then npm ci --no-audit --no-fund; else npm install --no-audit --no-fund; fi

COPY . ./
RUN mkdir -p /app/data && npm run build -- --webpack

FROM node:24.15.0-trixie-slim AS runner-base
WORKDIR /app

LABEL org.opencontainers.image.title="omniroute" \
  org.opencontainers.image.description="Unified AI proxy — route any LLM through one endpoint" \
  org.opencontainers.image.url="https://omniroute.online" \
  org.opencontainers.image.source="https://github.com/diegosouzapw/OmniRoute" \
  org.opencontainers.image.licenses="MIT"

ENV NODE_ENV=production
ENV PORT=20128
ENV HOSTNAME=0.0.0.0
ENV NODE_OPTIONS="--max-old-space-size=256"

# Data directory inside Docker — must match the volume mount in docker-compose.yml
ENV DATA_DIR=/app/data
RUN apt-get update \
  && apt-get install -y --no-install-recommends libsecret-1-0 ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN mkdir -p /app/data

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/.next/standalone ./
# Explicitly copy @swc/helpers — not always traced by standalone output but needed at runtime
COPY --from=builder /app/node_modules/@swc/helpers ./node_modules/@swc/helpers
# Explicitly copy pino transport dependencies — pino spawns a worker that requires
# pino-abstract-transport at runtime; Next.js standalone trace does not capture it (#449)
COPY --from=builder /app/node_modules/pino-abstract-transport ./node_modules/pino-abstract-transport
COPY --from=builder /app/node_modules/pino-pretty ./node_modules/pino-pretty
COPY --from=builder /app/node_modules/split2 ./node_modules/split2
# Migration SQL files are read via fs.readFileSync at runtime and are NOT
# traced by Next.js standalone output — copy them explicitly.
COPY --from=builder /app/src/lib/db/migrations ./migrations
ENV OMNIROUTE_MIGRATIONS_DIR=/app/migrations

COPY --from=builder /app/scripts/run-standalone.mjs ./run-standalone.mjs
COPY --from=builder /app/scripts/runtime-env.mjs ./runtime-env.mjs
COPY --from=builder /app/scripts/bootstrap-env.mjs ./bootstrap-env.mjs
COPY --from=builder /app/scripts/healthcheck.mjs ./healthcheck.mjs

EXPOSE 20128

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "healthcheck.mjs"]

CMD ["node", "run-standalone.mjs"]

FROM runner-base AS runner-cli

# Install system dependencies required by CLI agents (git+ssh references, Python for some tools).
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates docker.io docker-compose python3 python3-pip \
  && rm -rf /var/lib/apt/lists/* \
  && git config --system url."https://github.com/".insteadOf "ssh://git@github.com/"

# Install AI CLI agents globally with graceful fallbacks for tools that may not be on npm/pip.
# Claude CLI
RUN npm install -g --no-audit --no-fund @anthropic-ai/claude-code 2>/dev/null || echo "claude-code installation skipped"
# Cursor CLI
RUN npm install -g --no-audit --no-fund cursor-cli 2>/dev/null || echo "cursor-cli installation skipped"
# Gemini CLI
RUN npm install -g --no-audit --no-fund @google/generative-ai 2>/dev/null || echo "gemini-cli installation skipped"
# Codex CLI
RUN npm install -g --no-audit --no-fund @openai/codex 2>/dev/null || echo "codex installation skipped"
# Kimi CLI (Python-based)
RUN pip3 install --no-cache-dir kimi-cli 2>/dev/null || echo "kimi-cli installation skipped"
# OpenClaw agent
RUN npm install -g --no-audit --no-fund openclaw@latest 2>/dev/null || echo "openclaw installation skipped"
# Droid CLI
RUN npm install -g --no-audit --no-fund droid 2>/dev/null || echo "droid installation skipped"

# Create persistent home directory structure for CLI configs and cache
RUN mkdir -p /root/.config /root/.cache /root/.local/share && chmod 700 /root/.ssh
