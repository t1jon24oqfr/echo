# Echo API — DigitalOcean App Platform container.
# Multi-stage: a builder that compiles TS + generates the Prisma client, and a
# slim runtime that ships ffmpeg (visual-import frame extraction) + sharp libs.

# ---------- builder ----------
FROM node:22-slim AS builder
WORKDIR /app

# OpenSSL is needed by the Prisma engine during `prisma generate`.
# libvips-dev + build-essential/python3/pkg-config + node-gyp/node-addon-api are
# needed to source-build sharp (see below).
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
       openssl ca-certificates \
       build-essential python3 pkg-config libvips-dev \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci
# --- v1-CPU sharp fix (1984/FlokiNet QEMU CPU presents as x86-64-v1) ---
# sharp 0.34.x ships ONLY a prebuilt @img binary that requires x86-64-v2 →
# "Unsupported CPU … require v2 microarchitecture" at boot. Bookworm's apt
# libvips is 8.14 (< the 8.17.3 that 0.34.x needs from source), so downgrade
# sharp to 0.33.5 and build it from source against the system libvips. 0.33.5's
# API (greyscale/resize/composite/metadata/failOn) matches this codebase.
RUN rm -rf node_modules/@img node_modules/sharp \
  && SHARP_FORCE_GLOBAL_LIBVIPS=1 npm install --no-save --build-from-source --foreground-scripts \
       node-addon-api node-gyp sharp@0.33.5 \
  && node -e "console.log('sharp libvips', require('sharp').versions.vips)"

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
# libvips42 = the shared lib the source-built sharp 0.33.5 links against at runtime.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg openssl ca-certificates libvips42 \
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
