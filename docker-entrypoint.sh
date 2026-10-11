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
    # 管理/教师账号口令：优先取 ADMIN_INITIAL_PASSWORD，未设置则随机生成并在下面这几行输出里打印一次
    npx tsx packages/server/prisma/seed.ts
    echo "[entrypoint] 种子数据导入完成 ✓"
    echo "[entrypoint] ⚠️  上面的日志里含有管理员初始口令，请立即记录；系统不会再次显示。"
    echo "[entrypoint]     也可在部署前用环境变量 ADMIN_INITIAL_PASSWORD 指定固定口令。"
  else
    echo "[entrypoint] 数据库已有 $HAS_USERS 个用户，跳过种子导入"
  fi
fi

# ── 4. 启动应用服务 ───────────────────────────────────────
echo "[entrypoint] 启动应用服务..."
echo "═══════════════════════════════════════"
exec node packages/server/dist/index.js
