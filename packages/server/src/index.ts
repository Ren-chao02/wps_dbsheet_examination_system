import { createApp } from './app';
import { config } from './config';
import { startGradingWorkers, stopGradingWorkers } from './jobs/grading-queue';

const app = createApp();

// 启动 BullMQ 判分 Worker
startGradingWorkers();

const server = app.listen(config.port, () => {
  console.log(`Server running on port ${config.port} [${config.nodeEnv}]`);
});

// 优雅退出
const shutdown = async () => {
  console.log('Shutting down...');
  await stopGradingWorkers();
  server.close(() => process.exit(0));
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
