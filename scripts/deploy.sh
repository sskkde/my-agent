#!/usr/bin/env bash
# Deploy entry point: decrypt SOPS-encrypted secrets, build & start services,
# then remove plaintext (running containers keep the bind-mounted secrets).
# Usage: ./scripts/deploy.sh [compose args...]   e.g. ./scripts/deploy.sh --build api
set -euo pipefail
cd "$(dirname "$0")/.."

./scripts/decrypt-secrets.sh
trap 'rm -f secrets/app_secret_key.txt secrets/api_auth_token.txt secrets/deepseek_api_key.txt .env.production' EXIT

docker compose up -d --build "$@"
