# Content API — MongoDB + Redis + Express.
FROM node:22-alpine AS deps
WORKDIR /app
ENV NPM_CONFIG_UPDATE_NOTIFIER=false

COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/cms/package.json apps/cms/
RUN npm ci --omit=dev --workspace @rainbow/api --include-workspace-root

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

RUN apk add --no-cache tini && addgroup -g 1001 app && adduser -u 1001 -G app -s /bin/sh -D app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY packages/core ./packages/core
COPY apps/api ./apps/api
# The seed reads the authored templates and catalogues from here.
COPY content-source ./content-source

RUN mkdir -p /data/uploads && chown -R app:app /data/uploads /app

USER app
EXPOSE 4000
ENV UPLOAD_DIR=/data/uploads \
    CONTENT_SOURCE_DIR=/app/content-source \
    WEB_PUBLIC_DIR=/app/apps/web/public

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "apps/api/src/index.js"]
