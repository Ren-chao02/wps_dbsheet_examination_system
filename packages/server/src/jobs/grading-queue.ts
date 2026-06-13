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
    { connection: conn, concurrency: 3 }
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
