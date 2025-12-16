# syntax = docker/dockerfile:1

# Use a lightweight Node image and multi-stage build to keep image small.
ARG NODE_VERSION=20
FROM node:${NODE_VERSION}-alpine AS build

WORKDIR /app
ENV NODE_ENV=production

# Install production dependencies only (no dev deps)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy app sources
COPY . .

# Final runtime image
FROM node:${NODE_VERSION}-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Copy app and node_modules from build stage
COPY --from=build /app /app

# Fly.io sets $PORT; server.js respects process.env.PORT
EXPOSE 3000

CMD ["node", "server.js"]
