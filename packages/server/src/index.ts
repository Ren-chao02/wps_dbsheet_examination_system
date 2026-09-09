import { createServer } from 'http';
import { createApp } from './app';
import { config } from './config';
import { startGradingWorkers, stopGradingWorkers } from './jobs/grading-queue';
import { startImportWorkers, stopImportWorkers } from './jobs/import-queue';
import { initSocketIO } from './services/socket';
import { notificationService } from './services/notification-service';
import { wpsConfigService } from './services/wps-config-service';
import { batchScheduler } from './services/batch-scheduler';

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
});

// 优雅退出
const shutdown = async () => {
  console.log('Shutting down...');
  wpsConfigService.stopAutoRefresh();
  batchScheduler.stop();
  await stopGradingWorkers();
  await stopImportWorkers();
  httpServer.close(() => process.exit(0));
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
