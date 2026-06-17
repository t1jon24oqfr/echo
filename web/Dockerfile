# Echo Web (Next.js 16) — DigitalOcean App Platform container.
# Multi-stage: a builder that compiles the Next app into a self-contained server
# (next.config output:'standalone'), and a slim runtime that ships only the
# standalone server + static assets + public/ (no dev deps, no full node_modules).
#
# NEXT_PUBLIC_API_URL is inlined at BUILD time — App Platform must pass it as a
# build arg / build-scope env so the prod API base is baked into the bundle.

# ---------- builder ----------
FROM node:22-slim AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Next inlines NEXT_PUBLIC_* at build time; default keeps a working image even
# if the build env is omitted, but prod should always override this.
ARG NEXT_PUBLIC_API_URL=https://api.exchat.ai
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ---------- runtime ----------
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3047
ENV HOSTNAME=0.0.0.0

# Standalone output bundles a minimal node_modules + server.js. Static assets
# and public/ are NOT included by the trace, so copy them in explicitly.
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

EXPOSE 3047
# server.js is emitted by Next's standalone output; it reads PORT/HOSTNAME.
CMD ["node", "server.js"]
