# CMS admin — a static single-page app served by nginx.
FROM node:22-alpine AS build
WORKDIR /app
ENV NPM_CONFIG_UPDATE_NOTIFIER=false

COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/cms/package.json apps/cms/
RUN npm ci --workspace @rainbow/cms --include-workspace-root

COPY packages/core ./packages/core
COPY apps/cms ./apps/cms
RUN npm run build --workspace @rainbow/cms

FROM nginx:1.27-alpine AS runtime
COPY --from=build /app/apps/cms/dist /usr/share/nginx/html/admin
COPY apps/cms/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
