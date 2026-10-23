/**
 * 组卷预生成队列 — BullMQ
 *
 * 发布考试后异步为名单内每个考生生成卷子快照。与判分队列同一套连接/降级策略：
 * Redis 不可用时 `queued: false`，发布仍成功，开考时走现场生成兜底。
 *
 * 入队与 Worker 在同一文件：发布路径只依赖入队，Worker 只在 listen 成功后启动。
 */

import { randomUUID } from 'crypto';
import { Queue, Worker, type Job, type ConnectionOptions } from 'bullmq';
import { config } from '../config';
import { prisma } from '../config/prisma';
import {
  generateStudentPaper,
  listSlotCandidates, loadQuestionPoolWhereForExamPaper, schemaRefsSignature,
  type SlotRule,
} from '../services/paper-generator';
import {
  repairDifficultyDistribution, computeTargetCounts,
  type DifficultyTarget, type RepairSlotInput,
} from '../services/paper-difficulty-repair';
import { logger } from '../utils/logger';
import { STARTED_SUBMISSION_STATUSES } from '../services/submission-statuses';

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
    const baseJobId = `paper-generation-${examId}`;
    let jobId = baseJobId;
    await Promise.race([
      (async () => {
        // BullMQ 的 Queue.remove 对 locked/active job 返回 0（不抛错）。
        // 0 = 任务正在运行：同 jobId 的 add 会被静默去重，本轮重建就永远不会跑，
        // 因此改用带 UUID 的后继 jobId 再排一个任务（生成幂等，两轮先后/并发都安全）。
        // remove 抛错（Redis/客户端异常）同样按"不确定"处理，用后继 id，避免撞上残留 job。
        // remove 与 add 放在同一个 race 里：Redis 假死时 remove 也会挂住，不能只给 add 兜超时。
        try {
          const removed = await q.remove(baseJobId);
          if (removed === 0) jobId = `${baseJobId}-${randomUUID()}`;
        } catch {
          jobId = `${baseJobId}-${randomUUID()}`;
        }
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
  /** 可选：不注入 = 不做修复（Task 5 的隔离测试不能摸真实 DB） */
  repair?: (examId: string, studentId: string) => Promise<boolean>;
  /** 可选：不注入 = 不写分布/降级汇总 */
  loadSummaryInput?: (examId: string) => Promise<GenerationSummaryInput | null>;
}

const defaultDeps: PaperGenerationDeps = {
  listStudents: async (examId) => {
    const rows = await prisma.examRoomStudent.findMany({
      where: { assignment: { examId } },
      select: { studentId: true },
      orderBy: { studentId: 'asc' },   // 确定性：同一批学生顺序稳定
    });
    // 同一学生可能被分到多个考场（唯一键是 assignmentId+studentId）：去重后再生成/计数
    return [...new Map(rows.map(r => [r.studentId, r])).values()];
  },
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
  repair: (examId, studentId) => repairStudentPaper(examId, studentId),
  loadSummaryInput: async (examId) => {
    const [rows, ruleSlotCount, examRow] = await Promise.all([
      prisma.studentExamQuestion.findMany({
        where: { examId },
        select: { studentId: true, source: true, pickMeta: true, question: { select: { difficulty: true } } },
      }),
      prisma.examQuestion.count({ where: { examId, slotType: 'rule' } }),
      prisma.exam.findUnique({ where: { id: examId }, select: { difficultyTarget: true } }),
    ]);
    return {
      snapshots: rows.map(r => ({
        studentId: r.studentId, source: r.source, pickMeta: r.pickMeta,
        difficulty: r.question?.difficulty ?? null,
      })),
      ruleSlotCount,
      target: (examRow?.difficultyTarget ?? null) as DifficultyTarget | null,
    };
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
 * 为一名学生跑修复；返回是否发生替换（供汇总统计）。
 * `db`/`listCandidates` 可注入：单测不碰真实 DB/题库；生产不传即用默认实现。
 * 候选池必须带 poolWhere（数据范围 P2）——否则修复会把别院系的题换进学生的卷子。
 */
export async function repairStudentPaper(
  examId: string,
  studentId: string,
  deps: { db?: any; listCandidates?: typeof listSlotCandidates } = {},
): Promise<boolean> {
  const db = deps.db ?? prisma;
  const listCandidates = deps.listCandidates ?? listSlotCandidates;

  const exam = await db.exam.findUnique({ where: { id: examId }, select: { difficultyTarget: true } });
  if (!exam?.difficultyTarget) return false;   // 没配目标 = 零行为变化

  const [slots, rows, poolWhere] = await Promise.all([
    // 排序与 generateStudentPaper 对齐（slotIndex 再 sortOrder）：历史 0 值题位靠 `|| i`
    // 归一化，迭代顺序不一致会把修复写到别的题位上。这里只取抽题题位，混合卷的极端
    // 历史数据（fixed 也带 0 值）与生成仍有偏差，但正常数据不会触发该分支。
    db.examQuestion.findMany({ where: { examId, slotType: 'rule' }, orderBy: [{ slotIndex: 'asc' }, { sortOrder: 'asc' }] }),
    db.studentExamQuestion.findMany({ where: { examId, studentId }, select: { slotIndex: true, questionId: true, score: true } }),
    loadQuestionPoolWhereForExamPaper(examId, db),
  ]);
  if (slots.length === 0 || rows.length === 0) return false;

  const rowBySlot = new Map(rows.map((r: any) => [r.slotIndex, r]));
  const usedIds = new Set<string>(rows.map((r: any) => r.questionId));
  const inputs: RepairSlotInput[] = [];

  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    const slotIndex = slot.slotIndex || i;   // 与 generateStudentPaper 同口径（历史 0 值行）
    const row = rowBySlot.get(slotIndex) as any;
    if (!row) continue;
    const rule = (slot.rule || {}) as SlotRule;
    const candidates = await listCandidates({
      rule, slotScore: row.score, level: 'strict',
      usedQuestionIds: new Set([...usedIds].filter(id => id !== row.questionId)),
      poolWhere, tx: db,
    });
    const current = await db.question.findUnique({ where: { id: row.questionId }, select: { difficulty: true } });
    inputs.push({
      slotIndex, slotScore: row.score,
      currentQuestionId: row.questionId, currentDifficulty: current?.difficulty ?? null,
      wantedSignature: rule.schemaRefs ? schemaRefsSignature(rule.schemaRefs) : '',
      candidates,
    });
  }

  const result = repairDifficultyDistribution(inputs, exam.difficultyTarget as DifficultyTarget);
  let changed = 0;
  for (const change of result.changes) {
    const res = await db.studentExamQuestion.updateMany({
      where: {
        examId, studentId, slotIndex: change.slotIndex,
        // 原子守卫：更新瞬间该生已有开考提交 → 不换题
        student: { submissions: { none: { examId, status: { in: [...STARTED_SUBMISSION_STATUSES] } } } },
      },
      data: {
        questionId: change.to,
        pickMeta: {
          level: 'repair', repairedFrom: change.from,
          candidates: change.candidates,
          wantedSignature: change.wantedSignature,
          actualSignature: change.actualSignature,
        },
      },
    });
    changed += res?.count ?? 0;
  }
  return changed > 0;
}

export interface GenerationSummaryInput {
  snapshots: Array<{ studentId: string; source: string; pickMeta: any; difficulty: string | null }>;
  ruleSlotCount: number;
  target: DifficultyTarget | null;
}

const SUMMARY_LEVELS = ['easy', 'medium', 'hard'] as const;
const LEVEL_RANK: Record<string, number> = {
  strict: 0, 'relax-schemaRefs': 1, 'relax-difficulty': 2, repair: 3,
};

/**
 * 组卷质量汇总（纯函数，便于单测）。
 *
 * 口径（与 spec 第六/八节一致）：
 * - 分布按**每卷平均道数**（1 位小数）：目标按每卷道数算，直接拿全场总数比会失真；
 * - 降级按**卷**分桶，同一卷多个降级题位只计一次、取最差档位；
 *   无 pickMeta 的历史快照不计入（和可能小于 papers）。
 */
export function buildGenerationSummary(input: GenerationSummaryInput) {
  const { snapshots, ruleSlotCount, target } = input;
  const papers = new Set(snapshots.map(s => s.studentId)).size;
  const whole: Record<string, number> = { easy: 0, medium: 0, hard: 0 };
  const rule: Record<string, number> = { easy: 0, medium: 0, hard: 0 };
  const worst = new Map<string, string>();

  for (const s of snapshots) {
    const d = s.difficulty;
    if (d && d in whole) whole[d] += 1;
    if (s.source === 'rule' && d && d in rule) rule[d] += 1;
    const level = s.pickMeta?.level;
    if (typeof level !== 'string' || !(level in LEVEL_RANK)) continue;
    const prev = worst.get(s.studentId);
    if (!prev || LEVEL_RANK[level] > LEVEL_RANK[prev]) worst.set(s.studentId, level);
  }

  const degradation = { strict: 0, relaxSchemaRefs: 0, relaxDifficulty: 0, repaired: 0 };
  for (const level of worst.values()) {
    if (level === 'strict') degradation.strict += 1;
    else if (level === 'relax-schemaRefs') degradation.relaxSchemaRefs += 1;
    else if (level === 'relax-difficulty') degradation.relaxDifficulty += 1;
    else degradation.repaired += 1;
  }

  const perPaper = (counts: Record<string, number>) => {
    if (papers === 0) return { easy: 0, medium: 0, hard: 0 };
    return Object.fromEntries(
      SUMMARY_LEVELS.map(l => [l, Math.round((counts[l] / papers) * 10) / 10]),
    ) as Record<string, number>;
  };

  return {
    papers,
    distribution: {
      papers,
      ruleSlots: ruleSlotCount,
      // 空对象 / 全 0 目标视为未配置（DB 里可能有历史脏值）
      target: target && SUMMARY_LEVELS.some(l => (target[l] ?? 0) > 0)
        ? computeTargetCounts(target, ruleSlotCount)
        : null,
      actual: perPaper(rule),
      wholePaper: perPaper(whole),
    },
    degradation,
  };
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
    let repaired = 0;
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
        // 生成后再修复：题位之间争抢候选，只有整卷落库后才能算出偏差并等价替换。
        // 只修本次新生成的卷：已有快照（包括已开考）绝不动——补生成路径会跑同一个 job，
        // generateStudentPaper 对已有快照早退返回 created:0，这类卷子一律跳过。
        // JS 单线程，并发回调里自增不会丢计数。
        if (deps.repair && r.created > 0) {
          try {
            if (await deps.repair(examId, studentId)) repaired += 1;
          } catch (err) {
            // 修复是增强项：单卷修复失败不能让整场生成变成 failed（卷子已生成，保留原样）
            logger.warn({ examId, studentId, err }, '组卷修复失败，保留原卷');
          }
        }
      });
    }

    // 汇总统计失败不能让整场生成变成 failed：生成已经完成，报告只是附加信息
    let summary: Record<string, any> = {
      generated, missing: students.length - generated, repaired,
    };
    if (deps.loadSummaryInput) {
      try {
        const input = await deps.loadSummaryInput(examId);
        if (input) summary = { ...summary, ...buildGenerationSummary(input) };
      } catch (err) {
        logger.warn({ examId, err }, '组卷汇总统计失败，仅写基础进度');
      }
    }

    await deps.markStatus(examId, {
      status: 'done',
      summary,
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

/** 进度查询：总数按考位名单去重，已生成按快照里出现过的学生去重计数 */
export async function getPaperGenerationProgress(examId: string): Promise<{ totalStudents: number; generatedStudents: number }> {
  // 人数口径去重：同一学生可能被分到多个考场（唯一键 assignmentId+studentId），
  // 直接 count 会把总数算大，进度永远到不了 100%
  const [totalRows, generatedRows] = await Promise.all([
    prisma.examRoomStudent.groupBy({ by: ['studentId'], where: { assignment: { examId } } }),
    prisma.studentExamQuestion.findMany({ where: { examId }, select: { studentId: true }, distinct: ['studentId'] }),
  ]);
  return { totalStudents: totalRows.length, generatedStudents: generatedRows.length };
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
