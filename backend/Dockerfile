# ── Build stage ──────────────────────────────────────────
FROM node:18.20.4-alpine AS base

# System deps required by mediasoup native build (gcc, python3, make)
RUN apk add --no-cache python3 py3-pip make g++ linux-headers

WORKDIR /app

# Install dependencies — separate layer for cache efficiency
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile

# Copy source
COPY . .

# ── Runtime ───────────────────────────────────────────────
EXPOSE ${PORT:-4002}

# Ensure the data directory exists (for uploads + local storage)
RUN mkdir -p /app/data

# Phase 9 audit finding: no USER directive existed — the process ran as
# root inside the container. A code-execution vulnerability (a dependency
# CVE, a deserialization bug, anything) would have had root within the
# container's namespace/cgroup rather than being confined to an
# unprivileged user — standard container-hardening gap, cheap to close.
# Ownership handed to the new user AFTER yarn install (which ran as root
# to write node_modules) so the runtime user can actually read/execute
# everything it needs.
RUN addgroup -S app && adduser -S app -G app && chown -R app:app /app
USER app

CMD ["node", "index.js"]
