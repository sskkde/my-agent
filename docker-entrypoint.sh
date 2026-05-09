#!/bin/sh
set -e

echo "Running database migrations..."
npm run db:migrate || echo "Migration failed or already applied"

echo "Starting application..."
exec "$@"