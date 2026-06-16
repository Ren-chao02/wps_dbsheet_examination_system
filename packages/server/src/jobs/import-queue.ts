/**
 * 导入队列 — BullMQ
 *
 * 提供异步导入任务调度：
 * - 小文件（≤100行）：路由中同步处理
 * - 大文件（>100行）：走 BullMQ 队列异步处理
 *
 * Redis 不可用时降级为同步执行。
 */

import { Queue, Worker, Job, type ConnectionOptions } from 'bullmq';
import { config } from '../config';
import { processImport } from '../routes/students';
import fs from 'fs';
import { prisma } from '../config/prisma';

// ============================================================
// Redis 连接配置
// ============================================================

function getConnectionOpts(): ConnectionOptions | null {
  try {
    const url = new URL(config.redis.url);
    return {
      host: url.hostname,
      port: parseInt(url.port || '6379'),
      password: url.password || undefined,
      maxRetriesPerRequest: null as any,
    };
  } catch {
    console.warn('[ImportQueue] Redis URL 解析失败，将使用同步模式');
    return null;
  }
}

// ============================================================
// 队列定义
// ============================================================

interface ImportJobData {
  taskId: string;
  filePath: string;
  userId: string;
}

let importQueue: Queue | null = null;

function getImportQueue(): Queue | null {
  if (importQueue) return importQueue;
  const conn = getConnectionOpts();
  if (!conn) return null;
  importQueue = new Queue('import-queue', { connection: conn });
  return importQueue;
}

// ============================================================
// 入队方法
// ============================================================

/**
 * 将导入任务加入队列。
 * Redis 不可用时同步执行。
 */
export async function enqueueImport(taskId: string, filePath: string): Promise<{ jobId: string } | { syncResult: any }> {
  const queue = getImportQueue();

  if (!queue) {
    console.log('[ImportQueue] Redis 不可用，同步执行导入');
    // 同步模式下需要知道 userId
    const task = await prisma.importTask.findUnique({ where: { id: taskId } });
    const result = await processImport(taskId, filePath, task?.createdBy || '');
    // 清理临时文件
    try { fs.unlinkSync(filePath); } catch {}
    return { syncResult: result };
  }

  const task = await prisma.importTask.findUnique({ where: { id: taskId } });
  const job = await queue.add('import', {
    taskId,
    filePath,
    userId: task?.createdBy || '',
  } as ImportJobData, {
    attempts: 2,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: 20,
    removeOnFail: 10,
  });

  return { jobId: job.id! };
}

// ============================================================
// Worker（后台处理）
// ============================================================

let importWorker: Worker | null = null;

/**
 * 启动导入 Worker（在 index.ts 中调用）
 */
export function startImportWorkers(): void {
  const conn = getConnectionOpts();
  if (!conn) {
    console.log('[ImportQueue] Redis 不可用，Worker 未启动（将使用同步模式）');
    return;
  }

  importWorker = new Worker(
    'import-queue',
    async (job: Job) => {
      const data = job.data as ImportJobData;
      console.log(`[ImportQueue] 开始处理导入: taskId=${data.taskId}`);
      const result = await processImport(data.taskId, data.filePath, data.userId);
      console.log(`[ImportQueue] 导入完成: taskId=${data.taskId}, success=${result.successRows}, failed=${result.failedRows}`);

      // 清理临时文件
      try { fs.unlinkSync(data.filePath); } catch {}

      return result;
    },
    { connection: conn, concurrency: 1 },
  );

  importWorker.on('failed', (job, err) => {
    console.error(`[ImportQueue] 导入失败: job=${job?.id}, error=${err.message}`);
  });

  importWorker.on('completed', (job) => {
    console.log(`[ImportQueue] 导入任务完成: job=${job.id}`);
  });

  console.log('[ImportQueue] 导入 Worker 已启动');
}

/**
 * 关闭 Worker（优雅退出）
 */
export async function stopImportWorkers(): Promise<void> {
  await importWorker?.close();
  importWorker = null;
}
