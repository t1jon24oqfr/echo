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

# Container healthcheck. The node:22-slim runtime ships NO curl/wget, so the
# platform's default `curl || wget` probe always failed (running:unhealthy even
# though the app serves 200). Use the bundled node binary to GET / on the local
# port and exit non-zero on any status >= 400 or connection error. Defining
# HEALTHCHECK here makes Coolify defer to it (custom_healthcheck_found) instead
# of injecting its curl/wget CMD-SHELL.
HEALTHCHECK --interval=10s --timeout=5s --start-period=15s --retries=5 \
  CMD node -e "require('http').get({host:'127.0.0.1',port:process.env.PORT||3047,path:'/'},r=>process.exit(r.statusCode<400?0:1)).on('error',()=>process.exit(1))"

# server.js is emitted by Next's standalone output; it reads PORT/HOSTNAME.
CMD ["node", "server.js"]
