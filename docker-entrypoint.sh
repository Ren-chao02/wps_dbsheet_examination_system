#!/bin/sh
set -e

echo "═══════════════════════════════════════"
echo "  金山多维表格考试系统 - 启动入口"
echo "═══════════════════════════════════════"

# ── 1. 等待 PostgreSQL 就绪 ──────────────────────────────
# 从 DATABASE_URL 解析主机和端口：postgresql://user:pass@host:port/db
PG_HOST=$(echo "$DATABASE_URL" | sed -n 's|.*@\([^:]*\):.*|\1|p')
PG_PORT=$(echo "$DATABASE_URL" | sed -n 's|.*:\([0-9]*\)/.*|\1|p')
PG_PORT="${PG_PORT:-5432}"

echo "[entrypoint] 等待 PostgreSQL ($PG_HOST:$PG_PORT) 就绪..."
until nc -z "$PG_HOST" "$PG_PORT"; do
  echo "[entrypoint] PostgreSQL 未就绪，2 秒后重试..."
  sleep 2
done
echo "[entrypoint] PostgreSQL 已就绪 ✓"

# ── 2. 执行数据库迁移（建表）───────────────────────────────
echo "[entrypoint] 执行数据库迁移 (prisma migrate deploy)..."
npx prisma migrate deploy --schema=packages/server/prisma/schema.prisma
echo "[entrypoint] 迁移完成 ✓"

# ── 3. 首次部署自动导入种子数据（题库 + 账号）────────────
# 通过检查 users 表是否有数据判断是否为首次部署。
# 数据卷持久化后容器重启不会重复执行（避免清空已有数据）。
if [ "$SKIP_SEED" = "1" ]; then
  echo "[entrypoint] SKIP_SEED=1，跳过种子数据导入"
else
  HAS_USERS=$(node -e "
    const { PrismaClient } = require('@prisma/client');
    const p = new PrismaClient();
    p.user.count()
      .then(c => { console.log(c); return p.\$disconnect(); })
      .catch(() => { console.log('ERROR'); process.exit(1); });
  ")
  if [ "$HAS_USERS" = "0" ]; then
    echo "[entrypoint] 首次部署，导入种子数据（题库/账号/考试）..."
    npx tsx packages/server/prisma/seed.ts
    echo "[entrypoint] 种子数据导入完成 ✓"
  else
    echo "[entrypoint] 数据库已有 $HAS_USERS 个用户，跳过种子导入"
  fi
fi

# ── 4. 启动应用服务 ───────────────────────────────────────
echo "[entrypoint] 启动应用服务..."
echo "═══════════════════════════════════════"
exec node packages/server/dist/index.js
