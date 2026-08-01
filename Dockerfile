# 金山多维表格考试系统 - 生产镜像
# 单阶段构建：同时包含 prisma CLI（运行时迁移用）、编译产物和前端静态文件
# 使用 Debian 基础镜像（slim），Prisma 引擎在 Alpine(musl) 上有兼容问题
FROM node:20-slim

# 等待数据库就绪的检测命令 + Prisma 引擎所需的 OpenSSL
RUN apt-get update \
  && apt-get install -y --no-install-recommends netcat-openbsd openssl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 先复制依赖清单，充分利用 Docker 层缓存
COPY package.json package-lock.json ./
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
RUN npm ci

# 复制源码
COPY . .

# 生成 Prisma Client（服务端编译依赖 @prisma/client）
RUN npx prisma generate --schema=packages/server/prisma/schema.prisma

# 构建服务端（tsc）与前端（vite build）
RUN npm run build

# 入口脚本（迁移 + 种子数据 + 启动）
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 3002

ENTRYPOINT ["docker-entrypoint.sh"]
