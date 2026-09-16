# Многостадийная сборка дашборда (этап 6).
#
# Стадия build: pnpm, установка всего монорепо, сборка contracts -> server -> web, затем
# `pnpm deploy` вырезает из монорепо только сервер с production-зависимостями.
# Стадия runtime: Node без pnpm и без исходников; сервер отдает API, websocket и собранный
# фронт на одном порту (STATIC_DIR).
#
# Сборка из корня репозитория:
#   docker build -f docker/Dockerfile -t ra-dashboard .
# Для публикации под префиксом (стенд moarse.ru/ra):
#   docker build -f docker/Dockerfile --build-arg BASE_PATH=/ra/ -t ra-dashboard .

FROM node:22-alpine AS build
WORKDIR /repo
RUN npm install -g pnpm@11.16.0

# Сначала только манифесты: слой зависимостей переиспользуется, пока не менялся lock-файл.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/contracts/package.json packages/contracts/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile

COPY packages packages
COPY apps apps
# Префикс публикации за обратным прокси. Vite вшивает его в адреса сборки, сервер снимает
# его с запросов, поэтому значение одно на обе стадии.
ARG BASE_PATH=/
RUN pnpm --filter @ra/contracts build \
  && pnpm --filter @ra/server build \
  && pnpm --filter @ra/web build
# `--legacy`: pnpm 10+ без него требует inject-workspace-packages для deploy.
RUN pnpm --filter @ra/server deploy --prod --legacy /out

FROM node:22-alpine AS runtime
WORKDIR /app
ARG BASE_PATH=/
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3001 \
    STATIC_DIR=/app/public \
    BASE_PATH=$BASE_PATH
COPY --from=build /out/package.json ./package.json
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /repo/apps/server/dist ./dist
COPY --from=build /repo/apps/web/dist ./public
USER node
EXPOSE 3001
# Проверка идет без префикса: сервер обслуживает оба варианта адреса.
HEALTHCHECK --interval=15s --timeout=3s --start-period=30s \
  CMD wget -qO- http://127.0.0.1:3001/api/health > /dev/null || exit 1
CMD ["node", "dist/index.js"]
