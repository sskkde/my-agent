# Frontend Web Server Dockerfile
FROM node:20-alpine

WORKDIR /app

# Copy root package files first (for any shared dependencies)
COPY package*.json ./

# Copy web package files
COPY web/package*.json ./web/

# Install web dependencies
WORKDIR /app/web
RUN npm ci

# Copy source files (both root src/ and web/)
WORKDIR /app
COPY src/ ./src/
COPY web/ ./web/

WORKDIR /app/web

EXPOSE 3002

ENV VITE_PORT=3002
ENV VITE_API_TARGET=http://api:3003

CMD ["npm", "run", "dev"]
