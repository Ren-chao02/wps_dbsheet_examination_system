import { createServer } from 'http';
import { createApp } from './app';
import { config } from './config';
import { startGradingWorkers, stopGradingWorkers } from './jobs/grading-queue';
import { startImportWorkers, stopImportWorkers } from './jobs/import-queue';
import { initSocketIO, getIO } from './services/socket';
import { notificationService } from './services/notification-service';
import { wpsConfigService } from './services/wps-config-service';
import { batchScheduler } from './services/batch-scheduler';
import { initTelemetry } from './utils/telemetry';

const app = createApp();
const httpServer = createServer(app);

// 初始化 Socket.IO（考试监控 + 通知推送）
const io = initSocketIO(httpServer);
notificationService.initialize(io);

// 定时任务必须在端口监听成功后才启动：
// 若启动在 listen 之前，端口冲突（EADDRINUSE）导致进程崩溃时，
// startAutoRefresh 的立即检查仍可能发出刷新请求，消费掉一次性的
// refresh_token 却来不及落库，造成 token 链永久断裂
httpServer.listen(config.port, () => {
  console.log(`Server running on port ${config.port} [${config.nodeEnv}]`);
  console.log(`Socket.IO ready on ws://localhost:${config.port}`);
  // 启动 BullMQ 判分 Worker
  startGradingWorkers();
  // 启动 BullMQ 导入 Worker
  startImportWorkers();
  // 启动 WPS Token 自动刷新定时任务
  if (config.nodeEnv !== 'test') {
    wpsConfigService.startAutoRefresh();
    batchScheduler.start();
  }
  // 错误上报：放在 listen 回调里（与定时任务同理）——没配 SENTRY_DSN 时什么都不做
  initTelemetry();
});

/**
 * 优雅退出。
 *
 * ⚠️ `httpServer.close()` 只会在**所有连接关闭后**才回调，而 socket.io 的长连接
 * 与 HTTP keep-alive 会一直挂着它 —— 于是进程永不退出：
 *   - 开发时 tsx watch 每次热重载都卡在 "Process hasn't exited"，新进程起不来
 *   - 生产 docker stop 要等超时后被 SIGKILL（不是优雅退出）
 * 因此这里主动断开 socket.io 与残余连接，并加一道兜底超时强制退出。
 */
let shuttingDown = false;
const shutdown = async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('Shutting down...');

  // 兜底：无论下面卡在哪一步，5 秒后强制退出
  const forceExit = setTimeout(() => {
    console.warn('[shutdown] 超时强制退出');
    process.exit(0);
  }, 5000);
  forceExit.unref();

  try {
    wpsConfigService.stopAutoRefresh();
    batchScheduler.stop();
    await stopGradingWorkers();
    await stopImportWorkers();

    // 主动关闭长连接：socket.io 客户端与 keep-alive 连接不关，close() 永不回调
    const io = getIO();
    if (io) await io.close().catch(() => { /* 关闭失败也无妨，有兜底超时 */ });

    httpServer.close(() => process.exit(0));
    // 已被 close() 摘除的残余 socket（Node 18+ 提供）直接销毁
    (httpServer as any).closeAllConnections?.();
  } catch (err) {
    console.error('[shutdown] 退出过程出错:', err);
    process.exit(1);
  }
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
