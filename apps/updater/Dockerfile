# syntax=docker/dockerfile:1
FROM node:22-alpine
RUN apk add --no-cache docker-cli docker-cli-compose
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION NODE_ENV=production
WORKDIR /app
COPY apps/updater/package.json ./
COPY apps/updater/src ./src
# Runs as root only because the Docker socket requires it. See SECURITY.md.
EXPOSE 4002
CMD ["node", "src/main.mjs"]
