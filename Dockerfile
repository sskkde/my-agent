# API Server Dockerfile
FROM node:20-alpine

# Install build dependencies for better-sqlite3 and curl for healthcheck
RUN apk add --no-cache python3 make g++ curl

# Set working directory
WORKDIR /app

# Copy package files first for better layer caching
COPY package*.json ./

# Install production dependencies only
RUN npm ci --omit=dev

# Copy source code
COPY . .

# Create data directory for SQLite
RUN mkdir -p /data

# Copy and setup entrypoint script
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Expose API port
EXPOSE 3003

# Set environment variables
ENV HOST=0.0.0.0
ENV PORT=3003
ENV DATABASE_PATH=/data/agent-platform.db
ENV NODE_ENV=production

# OCI image labels
LABEL org.opencontainers.image.version="0.8.0-ga-candidate"
LABEL org.opencontainers.image.description="Agent Platform API"
LABEL org.opencontainers.image.title="Agent Platform API"
LABEL org.opencontainers.image.source="https://github.com/ohmyopencode/agent-platform"

# Health check
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -f http://127.0.0.1:3003/api/v1/health || exit 1

# Start API server
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["npm", "run", "start:api"]
