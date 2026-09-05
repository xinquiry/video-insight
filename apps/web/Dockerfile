# 构建上下文必须是仓库根(pnpm monorepo)。
FROM node:22-alpine AS base
WORKDIR /repo
RUN corepack enable

# 仅拷贝依赖清单,最大化利用层缓存。
FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml* package.json* ./
COPY packages/ui/package.json packages/ui/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @videoinsight/web...

FROM base AS dev
COPY --from=deps /repo ./
COPY packages ./packages
COPY apps/web ./apps/web
WORKDIR /repo/apps/web
EXPOSE 5173
CMD ["pnpm", "dev", "--host", "0.0.0.0"]

FROM base AS build
COPY --from=deps /repo ./
COPY packages ./packages
COPY apps/web ./apps/web
RUN pnpm --filter @videoinsight/web build

FROM nginx:alpine AS production
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
