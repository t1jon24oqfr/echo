# Echo API — DigitalOcean App Platform container.
# Multi-stage: a builder that compiles TS + generates the Prisma client, and a
# slim runtime that ships ffmpeg (visual-import frame extraction) + sharp libs.

# ---------- builder ----------
FROM node:22-slim AS builder
WORKDIR /app

# OpenSSL is needed by the Prisma engine during `prisma generate`.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY prisma ./prisma
# A dummy DATABASE_URL is enough for `prisma generate` (it never connects here).
ENV DATABASE_URL="postgresql://user:pass@localhost:5432/echo"
RUN npx prisma generate

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---------- runtime ----------
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# ffmpeg/ffprobe = visual-import frame extraction; openssl = Prisma engine;
# the rest are sharp runtime deps. node:22-slim already bundles most.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Copy the builder's node_modules verbatim: it already holds the generated
# Prisma client AND the prisma CLI (needed by `migrate deploy` in the entrypoint)
# at the exact pinned 6.19.3 — copying avoids any build-vs-runtime version skew
# (estate footgun) that a separate `npm ci` could introduce.
COPY package.json package-lock.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY prisma ./prisma
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

EXPOSE 3048
# Entrypoint applies pending migrations against the managed Postgres, THEN boots.
ENTRYPOINT ["./docker-entrypoint.sh"]
