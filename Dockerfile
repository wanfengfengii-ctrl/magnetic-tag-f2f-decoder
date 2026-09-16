# syntax=docker/dockerfile:1

# ---- web：构建静态产物并用 nginx 托管（纯前端，计算仅在浏览器） ----
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.27-bookworm AS web
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
# nginx 容器内固定监听 80；宿主端口由 docker compose 的 WEB_PORT 覆盖
CMD ["nginx", "-g", "daemon off;"]

# ---- verify：一次性验收（Vitest + Playwright），成功即退出 0 ----
FROM mcr.microsoft.com/playwright:v1.55.0-noble AS verify
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# 基础镜像以非 root 用户 pwuser 运行，保证其可写测试产物目录
RUN chown -R pwuser:pwuser /app
USER pwuser
# 基础镜像已预装 Chromium 及其全部系统依赖
CMD ["sh", "-c", "npm run typecheck && npm run test && npx playwright test"]
