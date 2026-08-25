# Astro SSR frontend.
FROM node:22-alpine AS build
WORKDIR /app
ENV NPM_CONFIG_UPDATE_NOTIFIER=false

COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/cms/package.json apps/cms/
RUN npm ci --workspace @rainbow/web --include-workspace-root

COPY packages/core ./packages/core
COPY apps/web ./apps/web
RUN npm run build --workspace @rainbow/web

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000

RUN apk add --no-cache tini && addgroup -g 1001 app && adduser -u 1001 -G app -s /bin/sh -D app

# The Astro node adapter serves everything from dist/, including the copy of
# public/ it takes at build time (css, js, images, video).
COPY --from=build --chown=app:app /app/apps/web/dist ./dist
COPY --from=build --chown=app:app /app/node_modules ./node_modules
COPY --chown=app:app apps/web/package.json ./package.json

USER app
EXPOSE 3000
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "./dist/server/entry.mjs"]
