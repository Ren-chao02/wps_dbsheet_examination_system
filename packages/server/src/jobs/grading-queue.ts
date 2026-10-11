/**
 * 判分队列 — BullMQ
 *
 * 提供异步判分任务调度：
 * - gradeSubmissionJob: 单份答卷自动判分
 * - gradeExamJob: 批量判分（整场考试）
 *
 * Redis 不可用时降级为同步执行。
 */

import { Queue, Worker, Job, type ConnectionOptions } from 'bullmq';
import { config } from '../config';
import { gradeSubmission, gradeExamSubmissions, type GradingResult } from '../services/grading-service';

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
    console.warn('[Queue] Redis URL 解析失败，将使用同步模式');
    return null;
  }
}

// ============================================================
// 队列定义
// ============================================================

interface GradingJobData {
  submissionId: string;
}

interface ExamGradingJobData {
  examId: string;
}

let gradingQueue: Queue | null = null;
let examGradingQueue: Queue | null = null;

function getGradingQueue(): Queue | null {
  if (gradingQueue) return gradingQueue;
  const conn = getConnectionOpts();
  if (!conn) return null;
  gradingQueue = new Queue('grading', { connection: conn });
  return gradingQueue;
}

function getExamGradingQueue(): Queue | null {
  if (examGradingQueue) return examGradingQueue;
  const conn = getConnectionOpts();
  if (!conn) return null;
  examGradingQueue = new Queue('exam-grading', { connection: conn });
  return examGradingQueue;
}

// ============================================================
// 入队方法
// ============================================================

/**
 * 将单份答卷判分任务加入队列。
 * Redis 不可用时同步执行。
 */
export async function enqueueGrading(submissionId: string): Promise<GradingResult> {
  const queue = getGradingQueue();
  if (!queue) {
    console.log('[Queue] Redis 不可用，同步执行判分');
    return gradeSubmission(submissionId);
  }

  const job = await queue.add('grade', { submissionId }, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: 100,
    removeOnFail: 50,
  });

  return waitForJob<GradingResult>(queue, job.id!);
}

/**
 * 批量入队（**不等待结果**）：每份答卷一个任务，由 Worker 并行消费。
 *
 * 为什么不复用 enqueueExamGrading：那个任务在 Worker 里仍是串行遍历，
 * 且 waitForJob 会让 HTTP 请求一直挂着。几千人规模的判分必须
 * 「立即返回 + 进度可查」，否则教师端只会看到请求超时而服务端还在跑。
 *
 * @returns 队列不可用时返回 null，调用方需回退同步执行
 */
export async function enqueueExamGradingBatch(
  examId: string,
  submissionIds: string[],
): Promise<{ queued: number } | null> {
  const queue = getGradingQueue();
  if (!queue) return null;

  // addBulk：一次网络往返写入全部任务，避免 3000 次 add 的往返开销
  await queue.addBulk(
    submissionIds.map(submissionId => ({
      name: 'grade',
      data: { submissionId },
      opts: {
        attempts: 3,
        backoff: { type: 'exponential' as const, delay: 2000 },
        removeOnComplete: 200,
        removeOnFail: 100,
        jobId: `grade-${submissionId}`, // 同份答卷重复入队时去重（BullMQ 会忽略已存在的 jobId）
      },
    })),
  );

  console.log(`[Queue] exam ${examId}: queued ${submissionIds.length} grading jobs`);
  return { queued: submissionIds.length };
}

/**
 * 将整场考试批量判分任务加入队列。
 */
export async function enqueueExamGrading(examId: string): Promise<{ jobId: string } | { syncResult: any }> {
  const queue = getExamGradingQueue();
  if (!queue) {
    const result = await gradeExamSubmissions(examId);
    return { syncResult: result };
  }

  const job = await queue.add('grade-exam', { examId }, {
    attempts: 2,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: 20,
    removeOnFail: 10,
  });

  return { jobId: job.id! };
}

/**
 * 轮询等待 BullMQ 任务完成
 */
async function waitForJob<T>(queue: Queue, jobId: string, timeoutMs = 120_000): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const job = await queue.getJob(jobId);
    if (!job) throw new Error('任务不存在');

    const state = await job.getState();
    if (state === 'completed') return job.returnvalue as T;
    if (state === 'failed') throw new Error(job.failedReason || '判分失败');

    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error('判分超时');
}

// ============================================================
// Worker（后台处理）
// ============================================================

let gradingWorker: Worker | null = null;
let examGradingWorker: Worker | null = null;

/**
 * 启动判分 Worker（在 index.ts 中调用）
 */
export function startGradingWorkers(): void {
  const conn = getConnectionOpts();
  if (!conn) {
    console.log('[Worker] Redis 不可用，Worker 未启动（将使用同步模式）');
    return;
  }

  gradingWorker = new Worker(
    'grading',
    async (job: Job) => {
      const data = job.data as GradingJobData;
      console.log(`[Worker] 开始判分: submission=${data.submissionId}`);
      const result = await gradeSubmission(data.submissionId);
      console.log(`[Worker] 判分完成: submission=${data.submissionId}, score=${result.totalScore}/${result.maxScore}`);
      return result;
    },
    // 并发可调：判分瓶颈在 WPS 开放平台的限流，不是本机 CPU。
    // 3 太慢（3000 份 × 约 2s ≈ 33 分钟），默认提到 6；
    // 若 WPS 侧开始返回 429，把这个值调小即可（无需改代码）。
    { connection: conn, concurrency: Number(process.env.GRADING_CONCURRENCY) || 6 }
  );

  examGradingWorker = new Worker(
    'exam-grading',
    async (job: Job) => {
      const data = job.data as ExamGradingJobData;
      console.log(`[Worker] 开始批量判分: exam=${data.examId}`);
      const result = await gradeExamSubmissions(data.examId);
      console.log(`[Worker] 批量判分完成: exam=${data.examId}, success=${result.success}, failed=${result.failed}`);
      return result;
    },
    { connection: conn, concurrency: 1 }
  );

  gradingWorker.on('failed', (job, err) => {
    console.error(`[Worker] 判分失败: job=${job?.id}, error=${err.message}`);
  });

  examGradingWorker.on('failed', (job, err) => {
    console.error(`[Worker] 批量判分失败: job=${job?.id}, error=${err.message}`);
  });

  console.log('[Worker] 判分 Worker 已启动');
}

/**
 * 关闭 Worker（优雅退出）
 */
export async function stopGradingWorkers(): Promise<void> {
  await gradingWorker?.close();
  await examGradingWorker?.close();
  gradingWorker = null;
  examGradingWorker = null;
}
