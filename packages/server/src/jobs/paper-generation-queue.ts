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
    console.warn('[Queue] Redis URL 解析失败，组卷预生成将退回开考现场生成');
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

/**
 * 将某场考试的预生成任务加入队列。
 *
 * 返回 `{ queued: false }` 时调用方必须把状态行标成 failed —— 发布本身仍然是成功的，
 * 开考时会走现场生成兜底（慢，但不丢题）。
 */
export async function enqueuePaperGeneration(examId: string): Promise<{ queued: boolean }> {
  const q = getPaperGenerationQueue();
  if (!q) return { queued: false };
  await q.add('generate', { examId }, {
    jobId: `paper-generation-${examId}`, // 同考试重复发布/重试去重
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: 20,
    removeOnFail: 20,
  });
  return { queued: true };
}
