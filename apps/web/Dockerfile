# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* tsconfig.base.json ./
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --filter @automation/web...
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN pnpm --filter @automation/web build

FROM node:22-bookworm-slim AS runtime
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000 NEXT_TELEMETRY_DISABLED=1
# Fixed uid/gid so web and worker can share the /data volume.
RUN groupadd -g 10001 app && useradd -u 10001 -g 10001 -m app \
 && mkdir -p /data/artifacts && chown -R app:app /data
WORKDIR /repo
COPY --from=build --chown=app:app /repo/apps/web/.next/standalone ./
COPY --from=build --chown=app:app /repo/apps/web/.next/static ./apps/web/.next/static
USER app
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
