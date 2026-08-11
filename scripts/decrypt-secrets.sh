#!/usr/bin/env bash
# Materialize plaintext secrets from SOPS-encrypted sources (chmod 600).
# The plaintext is only needed while containers run; deploy.sh removes it
# after `docker compose up` (bind-mounted secrets stay visible inside running
# containers). Run this directly only if you manage containers manually.
set -euo pipefail
cd "$(dirname "$0")/.."

for enc in secrets/*.txt.age; do
  plain="${enc%.age}"
  sops -d "$enc" > "$plain"
  chmod 600 "$plain"
done

sops -d .env.production.age > .env.production
chmod 600 .env.production

echo "Secrets materialized: secrets/*.txt, .env.production (chmod 600)"
