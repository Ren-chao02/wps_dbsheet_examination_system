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

// 失败/放弃时的统一返回形状（与 processImport 的错误返回一致）
const EMPTY_IMPORT_RESULT = { totalRows: 0, successRows: 0, failedRows: 0, errorFile: null as string | null };

/**
 * fail-closed：拿不到任务创建者（userId）时不能用空串继续 —— processImport 里
 * `if (userId)` 会静默跳过教师范围校验，导入行就可能落到任意班级。
 * 任务行存在则标记 FAILED；行本身不存在时没有可更新的行，调用方自行记日志结束。
 */
async function markImportTaskFailed(taskId: string, reason: string): Promise<void> {
  console.error(`[ImportQueue] ${reason}，任务标记为 FAILED: taskId=${taskId}`);
  try {
    await prisma.importTask.update({
      where: { id: taskId },
      data: {
        status: 'FAILED',
        completedAt: new Date(),
      },
    });
  } catch (e: any) {
    console.error(`[ImportQueue] 更新任务状态失败: taskId=${taskId}, error=${e.message}`);
  }
}

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
    try {
      // fail-closed：任务行缺失时不能用空 userId 继续；行不存在无从标记 FAILED，
      // 只能记日志并结束本次导入（返回空结果，与 processImport 失败路径同一形状）。
      if (!task) {
        console.error(`[ImportQueue] 导入任务不存在，放弃同步导入: taskId=${taskId}`);
        return { syncResult: { ...EMPTY_IMPORT_RESULT } };
      }
      if (!task.createdBy) {
        await markImportTaskFailed(taskId, '导入任务缺少创建者');
        return { syncResult: { ...EMPTY_IMPORT_RESULT } };
      }
      const result = await processImport(taskId, filePath, task.createdBy);
      return { syncResult: result };
    } catch (err: any) {
      console.error(`[ImportQueue] 同步导入失败: taskId=${taskId}, error=${err.message}`);
      try {
        await prisma.importTask.update({
          where: { id: taskId },
          data: {
            status: 'FAILED',
            completedAt: new Date(),
          },
        });
      } catch (e: any) {
        console.error(`[ImportQueue] 更新任务状态失败: taskId=${taskId}, error=${e.message}`);
      }
      return { syncResult: { ...EMPTY_IMPORT_RESULT } };
    } finally {
      // 清理临时文件
      try { fs.unlinkSync(filePath); } catch {}
    }
  }

  const task = await prisma.importTask.findUnique({ where: { id: taskId } });
  // fail-closed：绝不把空 userId 塞进 job —— worker 里 processImport 依赖它做教师范围校验。
  // 抛错让调用方（导入路由）返回失败，而不是谎报「已提交后台处理」。
  if (!task) {
    console.error(`[ImportQueue] 导入任务不存在，拒绝入队: taskId=${taskId}`);
    throw new Error(`导入任务不存在: ${taskId}`);
  }
  if (!task.createdBy) {
    await markImportTaskFailed(taskId, '导入任务缺少创建者，拒绝入队');
    throw new Error(`导入任务缺少创建者: ${taskId}`);
  }

  const job = await queue.add('import', {
    taskId,
    filePath,
    userId: task.createdBy,
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

      // fail-closed：入队端已把关，但旧队列可能残留空 userId 的 job（本修复前入队的数据）。
      // 空 userId 会跳过 processImport 的教师范围校验，绝不能继续执行 ——
      // 标记任务 FAILED 后抛错结束该 job（抛错而非返回：job 状态如实记为失败，且会重试；
      // 重试仍走本分支，标记幂等）。
      if (!data.userId) {
        if (data.taskId) {
          await markImportTaskFailed(data.taskId, 'job 缺少 userId');
        } else {
          console.error('[ImportQueue] job 既无 taskId 又无 userId，直接丢弃');
        }
        try { fs.unlinkSync(data.filePath); } catch {}
        throw new Error(`导入任务缺少 userId: taskId=${data.taskId}`);
      }

      const result = await processImport(data.taskId, data.filePath, data.userId);
      console.log(`[ImportQueue] 导入完成: taskId=${data.taskId}, success=${result.successRows}, failed=${result.failedRows}`);

      // 清理临时文件
      try { fs.unlinkSync(data.filePath); } catch {}

      return result;
    },
    { connection: conn, concurrency: 1 },
  );

  importWorker.on('failed', async (job, err) => {
    console.error(`[ImportQueue] 导入失败: job=${job?.id}, error=${err.message}`);
    const taskId = job?.data?.taskId;
    if (taskId) {
      try {
        await prisma.importTask.update({
          where: { id: taskId },
          data: {
            status: 'FAILED',
            completedAt: new Date(),
          },
        });
      } catch (e: any) {
        console.error(`[ImportQueue] 更新任务状态失败: taskId=${taskId}, error=${e.message}`);
      }
    }
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
