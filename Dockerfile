# API Server Dockerfile
FROM node:20-alpine

# Install build dependencies for better-sqlite3
RUN apk add --no-cache python3 make g++

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Create data directory for SQLite
RUN mkdir -p /data

# Run database migrations
RUN npm run db:migrate

# Expose API port
EXPOSE 3003

# Set environment variables
ENV HOST=0.0.0.0
ENV PORT=3003
ENV DATABASE_PATH=/data/agent-platform.db
ENV NODE_ENV=development

# Start API server
CMD ["npm", "run", "start:api"]
