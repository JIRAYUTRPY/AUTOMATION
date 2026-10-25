# syntax=docker/dockerfile:1
# The image tag MUST match the "playwright" version pinned in apps/worker/package.json.
FROM mcr.microsoft.com/playwright:v1.55.0-noble
ARG APP_VERSION=dev
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NODE_ENV=production APP_VERSION=$APP_VERSION
RUN corepack enable
# Fixed uid/gid so web and worker can share the /data volume.
RUN groupadd -g 10001 app && useradd -u 10001 -g 10001 -m app \
 && mkdir -p /data/artifacts && chown -R app:app /data
WORKDIR /repo
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* tsconfig.base.json ./
COPY apps/worker/package.json apps/worker/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --filter @automation/worker...
COPY packages/shared packages/shared
COPY apps/worker apps/worker
RUN chown -R app:app /repo
USER app
EXPOSE 4001
# TypeScript runs through tsx; the Chromium sandbox stays enabled (no --no-sandbox).
CMD ["pnpm", "--filter", "@automation/worker", "start"]
