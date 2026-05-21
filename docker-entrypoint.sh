#!/bin/sh
set -e

# Read Docker secrets and set as environment variables
# Docker secrets are mounted at /run/secrets/<name> and accessed via <NAME>_FILE env vars
for secret_file_env in $(env | grep '_FILE=' | sed 's/=.*//'); do
  secret_file_path=$(eval echo "\$${secret_file_env}")
  if [ -f "$secret_file_path" ]; then
    secret_name=$(echo "$secret_file_env" | sed 's/_FILE$//')
    secret_value=$(cat "$secret_file_path" | tr -d '\n')
    export "$secret_name=$secret_value"
    unset "$secret_file_env"
  fi
done

echo "Running database migrations..."
npm run db:migrate

echo "Starting application..."
exec "$@"