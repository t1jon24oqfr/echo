#!/bin/sh
set -e

# Apply any pending migrations against the managed Postgres, then boot.
# migrate deploy is idempotent and safe to run on every container start
# (instance_count is 1, so no concurrent-migration race).
echo "[entrypoint] prisma migrate deploy"
npx prisma migrate deploy

echo "[entrypoint] starting Echo API"
exec node dist/main.js
