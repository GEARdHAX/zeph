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

CMD ["node", "index.js"]
