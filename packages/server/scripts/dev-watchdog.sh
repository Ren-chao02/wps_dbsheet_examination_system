#!/usr/bin/env bash
# 后端看门狗：`tsx watch` 偶尔会卡死成"有 watcher 进程、没有子进程、没人监听端口"的僵尸
# （日志特征：反复 `Process hasn't exited. Killing process...` 之后彻底静默；2026-10-13 与 10-15 各发生过一次）。
# 本脚本每 20 秒探一次 /api/health，连续 3 次无响应就清干净僵尸并重新拉起 dev server。
#
# 用法（后台跑，日志留在 /tmp/dev-watchdog.log）：
#   nohup bash scripts/dev-watchdog.sh >> /tmp/dev-watchdog.log 2>&1 &
# 停止：先 kill 掉看门狗本身再停服务（否则它会把你故意停掉的服务再拉起来）。
set -u

HEALTH="http://localhost:3002/api/health"
FAILS=0
THRESHOLD=3

while true; do
  if curl -sf --max-time 5 "$HEALTH" >/dev/null 2>&1; then
    if [ "$FAILS" -gt 0 ]; then
      echo "[$(date '+%F %T')] 后端恢复响应"
    fi
    FAILS=0
  else
    FAILS=$((FAILS + 1))
    echo "[$(date '+%F %T')] health 探测失败（$FAILS/$THRESHOLD）"
    if [ "$FAILS" -ge "$THRESHOLD" ]; then
      echo "[$(date '+%F %T')] 连续 $THRESHOLD 次无响应 —— 判定为僵尸 watcher，清理并重启"
      # 模式要能同时匹配新旧 dev 脚本形态（npm exec / sh -c 前缀 / 带 --exclude 参数）
      pkill -9 -f "tsx watch" 2>/dev/null
      sleep 1
      (cd "$(dirname "$0")/.." && setsid nohup npm run dev >> /tmp/dev-server.log 2>&1 < /dev/null &)
      FAILS=0
      sleep 15   # 留出启动时间，避免下一轮立刻又判失败
    fi
  fi
  sleep 20
done
