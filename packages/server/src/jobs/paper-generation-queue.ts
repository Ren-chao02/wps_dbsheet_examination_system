/**
 * 组卷预生成队列 — BullMQ
 *
 * 发布考试后异步为名单内每个考生生成卷子快照。与判分队列同一套连接/降级策略：
 * Redis 不可用时 `queued: false`，发布仍成功，开考时走现场生成兜底。
 *
 * Worker 在 Task 5 接入；本文件先只提供入队能力，保证发布路径不依赖 Worker 是否存在。
 */

import { Queue, type ConnectionOptions } from 'bullmq';
import { config } from '../config';
import { logger } from '../utils/logger';

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
    logger.warn('[Queue] Redis URL 解析失败，组卷预生成将退回开考现场生成');
    return null;
  }
}

// ============================================================
// 队列定义
// ============================================================

let queue: Queue | null = null;

export function getPaperGenerationQueue(): Queue | null {
  if (queue) return queue;
  const conn = getConnectionOpts();
  if (!conn) return null;
  queue = new Queue('paper-generation', { connection: conn });
  return queue;
}

// ============================================================
// 入队方法
// ============================================================

/** 入队超时：Redis 进程宕机但 URL 仍可解析时，ioredis 的离线队列会让 add 一直等重连 */
const ENQUEUE_TIMEOUT_MS = 3000;

/**
 * 将某场考试的预生成任务加入队列。
 *
 * 返回 `{ queued: false }` 时调用方必须把状态行标成 failed —— 发布本身仍然是成功的，
 * 开考时会走现场生成兜底（慢，但不丢题）。
 *
 * 这里必须自己兜住所有异常与超时：BullMQ/ioredis 在 Redis 半死不活时既可能抛错，
 * 也可能无限重连挂住，而发布接口不能被队列拖成 500/超时（考试此时已经发布了）。
 */
export async function enqueuePaperGeneration(examId: string): Promise<{ queued: boolean }> {
  const q = getPaperGenerationQueue();
  if (!q) return { queued: false };
  try {
    await Promise.race([
      q.add('generate', { examId }, {
        // 注意：同 jobId 在 completed/failed 集合里仍存在时，BullMQ 会静默忽略入队——
        // 重试/重发前必须先 remove（Task 6 的验收集）
        jobId: `paper-generation-${examId}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 20,
        removeOnFail: 20,
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('enqueue timeout')), ENQUEUE_TIMEOUT_MS)),
    ]);
    return { queued: true };
  } catch (err) {
    // 队列不可用/超时都按"未入队"处理：调用方标 failed，开考现场生成兜底
    logger.warn({ examId, err }, '组卷预生成入队失败');
    return { queued: false };
  }
}
