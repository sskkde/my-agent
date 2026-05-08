# Frontend Web Server Dockerfile
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./

RUN npm ci

COPY . .

EXPOSE 3002

ENV VITE_PORT=3002
ENV VITE_API_TARGET=http://api:3003

CMD ["npm", "run", "dev"]
