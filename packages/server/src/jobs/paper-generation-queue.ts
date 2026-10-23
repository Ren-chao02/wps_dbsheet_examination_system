/**
 * 组卷预生成队列 — BullMQ
 *
 * 发布考试后异步为名单内每个考生生成卷子快照。与判分队列同一套连接/降级策略：
 * Redis 不可用时 `queued: false`，发布仍成功，开考时走现场生成兜底。
 *
 * 入队与 Worker 在同一文件：发布路径只依赖入队，Worker 只在 listen 成功后启动。
 */

import { Queue, Worker, type Job, type ConnectionOptions } from 'bullmq';
import { config } from '../config';
import { prisma } from '../config/prisma';
import { generateStudentPaper } from '../services/paper-generator';
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
  // 计时器在 finally 里清理：入队成功后它还挂着的话，请求/测试进程会被无谓地拖住 3 秒
  let timer: NodeJS.Timeout | undefined;
  try {
    const jobId = `paper-generation-${examId}`;
    await Promise.race([
      (async () => {
        // 旧的同名 job 还在 completed/failed 集合里时，add 会被 BullMQ 静默去重：
        // 重试接口会返回"已触发"但实际没有任何任务在跑。先移除；任务正在运行时
        // remove 会抛错（locked），此时队列里确实有任务，忽略即可。
        // remove 与 add 放在同一个 race 里：Redis 假死时 remove 也会挂住，不能只给 add 兜超时。
        try { await q.remove(jobId); } catch { /* 运行中/已被移除 */ }
        await q.add('generate', { examId }, {
          jobId,
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: 20,
          removeOnFail: 20,
        });
      })(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('enqueue timeout')), ENQUEUE_TIMEOUT_MS);
      }),
    ]);
    return { queued: true };
  } catch (err) {
    // 队列不可用/超时都按"未入队"处理：调用方标 failed，开考现场生成兜底
    logger.warn({ examId, err }, '组卷预生成入队失败');
    return { queued: false };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ============================================================
// 预生成任务（分页、并发、取消、汇总）
// ============================================================

/** 依赖注入：生产用默认实现，测试用桩（避免真实队列/DB） */
export interface PaperGenerationDeps {
  listStudents: (examId: string) => Promise<Array<{ studentId: string }>>;
  generate: (examId: string, studentId: string) => Promise<{ created: number; total: number; unfilledSlots: Array<{ slotIndex: number; reason: string }> }>;
  getExamStatus: (examId: string) => Promise<string | null>;
  markStatus: (examId: string, patch: { status: string; error?: string; summary?: any; unfilledSlots?: any }) => Promise<void>;
}

const defaultDeps: PaperGenerationDeps = {
  listStudents: (examId) => prisma.examRoomStudent.findMany({
    where: { assignment: { examId } },
    select: { studentId: true },
    orderBy: { studentId: 'asc' },   // 确定性：同一批学生顺序稳定
  }),
  generate: (examId, studentId) => generateStudentPaper(examId, studentId),
  getExamStatus: async (examId) => (await prisma.exam.findUnique({ where: { id: examId }, select: { status: true } }))?.status ?? null,
  // updateMany 而非 update：迟到入队时状态行可能已被删除（考试取消级联），
  // 此时没有行可更新也不该让整个 job 再失败一次。
  markStatus: async (examId, patch) => {
    await prisma.examPaperGeneration.updateMany({ where: { examId }, data: {
      status: patch.status,
      // 非 failed 状态清空 error：迟到 job 把 failed 行覆盖成 done 后，
      // 不能残留"队列不可用"之类的过期原因（发布路径重发时也显式清空）
      error: patch.status === 'failed' ? (patch.error ?? null) : null,
      ...(patch.summary ? { summary: patch.summary } : {}),
      ...(patch.unfilledSlots ? { unfilledSlots: patch.unfilledSlots } : {}),
      ...(patch.status === 'running' ? { startedAt: new Date() } : {}),
      ...(patch.status === 'done' || patch.status === 'failed' ? { finishedAt: new Date() } : {}),
    } });
  },
};

/** 并发受限的 map：WPS 无关，瓶颈是本机 DB + CPU；4 是保守值 */
async function mapWithConcurrency<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await fn(item);
    }
  });
  await Promise.all(runners);
}

/**
 * 为一场考试名单内的所有考生预生成卷子并写回汇总。
 *
 * 幂等：`generateStudentPaper` 遇到已有快照会直接返回 total=existing，
 * 因此 Worker 无条件处理 job（包括"入队超时后迟到落库、状态行已被标 failed"的情况），
 * 用本次结果覆盖行状态即可，不会重复生成。
 */
export async function processPaperGeneration(
  examId: string,
  deps: PaperGenerationDeps = defaultDeps,
): Promise<{ generated: number; missing: number }> {
  await deps.markStatus(examId, { status: 'running' });

  try {
    const students = await deps.listStudents(examId);
    let generated = 0;
    const unfilled = new Map<string, { slotIndex: number; reason: string; students: number }>();

    const PAGE = 200;
    for (let i = 0; i < students.length; i += PAGE) {
      // 每页开始前检查考试状态：取消/结束/删除后不再继续生成
      const status = await deps.getExamStatus(examId);
      if (!status || status === 'cancelled' || status === 'ended' || status === 'archived') {
        await deps.markStatus(examId, { status: 'failed', error: `考试已${status === 'cancelled' ? '取消或删除' : '结束'}，生成中止` });
        return { generated, missing: students.length - generated };
      }

      const page = students.slice(i, i + PAGE);
      await mapWithConcurrency(page, 4, async ({ studentId }) => {
        const r = await deps.generate(examId, studentId);
        if (r.total > 0) generated += 1;
        for (const u of r.unfilledSlots) {
          const key = `${u.slotIndex}:${u.reason}`;
          const cur = unfilled.get(key) ?? { slotIndex: u.slotIndex, reason: u.reason, students: 0 };
          cur.students += 1;
          unfilled.set(key, cur);
        }
      });
    }

    await deps.markStatus(examId, {
      status: 'done',
      summary: { generated, missing: students.length - generated },
      unfilledSlots: [...unfilled.values()],
    });
    return { generated, missing: students.length - generated };
  } catch (err) {
    // 终态失败必须写回：否则状态行永久停在 running，前端无法区分"仍在生成"与"已经失败"。
    // 写回失败（DB 也不可用）不能掩盖原始异常；BullMQ 会按 attempts 重试，
    // 下一次进入函数时 running 会覆盖 failed，重试成功则最终为 done。
    await deps.markStatus(examId, {
      status: 'failed',
      error: err instanceof Error ? err.message : String(err),
    }).catch(() => {});
    throw err;
  }
}

/** 进度查询：总数按考位名单，已生成按快照里出现过的学生去重计数 */
export async function getPaperGenerationProgress(examId: string): Promise<{ totalStudents: number; generatedStudents: number }> {
  const [totalStudents, rows] = await Promise.all([
    prisma.examRoomStudent.count({ where: { assignment: { examId } } }),
    prisma.studentExamQuestion.findMany({ where: { examId }, select: { studentId: true }, distinct: ['studentId'] }),
  ]);
  return { totalStudents, generatedStudents: rows.length };
}

// ============================================================
// Worker（在 index.ts 的 listen 回调里启动）
// ============================================================

let worker: Worker | null = null;

export function startPaperGenerationWorkers(): void {
  const conn = getConnectionOpts();
  if (!conn) {
    logger.warn('[Worker] Redis 不可用，组卷预生成 Worker 未启动（开考时现场生成）');
    return;
  }
  worker = new Worker('paper-generation', async (job: Job) => {
    const { examId } = job.data as { examId: string };
    logger.info({ examId, jobId: job.id }, '[Worker] 开始预生成卷子');
    const result = await processPaperGeneration(examId);
    logger.info({ examId, jobId: job.id, ...result }, '[Worker] 预生成完成');
    return result;
  }, { connection: conn, concurrency: 1 });  // 一场考试一个 job；并发在 job 内控制
  worker.on('failed', (job, err) => logger.error({ examId: (job?.data as any)?.examId, jobId: job?.id, err }, '[Worker] 预生成失败'));
  logger.info('[Worker] 组卷预生成 Worker 已启动');
}

export async function stopPaperGenerationWorkers(): Promise<void> {
  await worker?.close();
  worker = null;
}
