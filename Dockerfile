# syntax=docker/dockerfile:1.7

FROM node:20-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
COPY testApp/package.json testApp/package-lock.json ./testApp/

RUN npm ci
RUN npm --prefix testApp ci

COPY . .

RUN npm run build:lib
RUN npm run build:server
RUN npm --prefix testApp run build

FROM node:20-bookworm-slim AS runtime

RUN apt-get update \
 && apt-get install -y --no-install-recommends bash poppler-utils \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV NODE_ENV=production \
    PORT=8787 \
    LLM_PROXY_HOST=0.0.0.0 \
    LLM_PROXY_ROOT_REDIRECT_PATH=/proxy \
    LLM_PROXY_APP_DIR=/app/testApp/dist \
    LLM_PROXY_CACHE_DIR=/data/cache \
    LLM_PROXY_TASKS_DIR=/data/tasks \
    LLM_PROXY_LOG_DIR=/data/logs \
    LLM_PROXY_GEMINI_ANALYTICS_DIR=/data/gemini-analytics \
    CODEX_EXEC_WORKDIR=/data/codex-workspaces

COPY package.json package-lock.json ./

RUN npm ci --omit=dev \
 && npm cache clean --force

COPY --from=build /app/dist-server ./dist-server
COPY --from=build /app/scripts/run-cloudflare-origin.mjs ./scripts/run-cloudflare-origin.mjs
COPY --from=build /app/testApp/dist ./testApp/dist

RUN mkdir -p /data /app/testApp/dist \
 && chown -R node:node /app /data

USER node

EXPOSE 8787
VOLUME ["/data"]

CMD ["node", "dist-server/server/src/index.js"]
