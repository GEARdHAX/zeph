# ── Frontend dev container (Vite HMR) ────────────────────
# Used by docker-compose for local development only.
# For production, `vite build` output is served by the backend's
# static middleware or Cloudflare Pages.

FROM node:18.20.4-alpine

WORKDIR /app

COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile

COPY . .

EXPOSE 5173

# Vite must listen on 0.0.0.0 inside the container so the host can reach it
CMD ["yarn", "dev", "--host", "0.0.0.0"]
