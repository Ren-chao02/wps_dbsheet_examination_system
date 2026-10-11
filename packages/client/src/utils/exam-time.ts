/**
 * 考试时间相关计算工具。
 * 计算口径与服务端 start-wps 入场校验（my-exams.ts）保持一致，避免前后端漂移。
 */
import api from '../services/api';

// ════════════════════════════════════════════════════════════
// 服务端时间同步
// ════════════════════════════════════════════════════════════
// 背景：机房电脑 CMOS 时钟漂移很常见。若拿本机 Date.now() 与服务端给的 deadline 比较，
// 钟快 10 分钟的学生倒计时会提前归零 → 自动交卷 → 丢 10 分钟且无法重进。
// 因此所有「拿当前时间跟服务端时间戳比较」的地方统一改用 serverNow()
// （= 本机时间 + 偏移量）。取不到服务端时间时偏移量保持 0，等价退回本机时间，
// 同步失败绝不会比不修更糟。

/** 本机时间 → 服务端时间 的偏移量（毫秒）。0 表示尚未同步成功，退回本机时间 */
let offsetMs = 0;
/** 进行中的同步请求（去重：倒计时每秒调 serverNow()，只允许同时存在一个请求） */
let syncPromise: Promise<void> | null = null;
/** 最近一次发起同步的时间（成败都记：失败时避免每 1 秒打一次接口） */
let lastSyncAttemptAt = 0;
/** 同步成功后的缓存有效期：局域网内 5 分钟内的漂移可忽略，到时自动重新对齐 */
const SYNC_SUCCESS_TTL = 5 * 60 * 1000;
/** 同步失败后的重试间隔（比成功缓存短：尽快从失败中恢复） */
const SYNC_RETRY_INTERVAL = 30 * 1000;
/** 同步请求超时：机房局域网内 /api/health 毫秒级返回，5 秒足够宽松 */
const SYNC_TIMEOUT_MS = 5000;

/**
 * 与服务端对齐时间（懒触发 + 缓存 + 失败兜底）。
 * 数据来源优先级：
 *   1. /api/health 响应体 timestamp（服务端显式生成的 ISO 时间，最直接）；
 *   2. HTTP 响应头 Date（每个响应都带，作为 body 被网关改写时的兜底）。
 * 失败（断网/服务不可达）时静默保持现有 offset，下一轮重试。
 */
export function syncServerTime(): Promise<void> {
  const nowMs = Date.now();
  if (syncPromise) return syncPromise;
  const throttle = offsetMs !== 0 ? SYNC_SUCCESS_TTL : SYNC_RETRY_INTERVAL;
  if (nowMs - lastSyncAttemptAt < throttle) return Promise.resolve();
  lastSyncAttemptAt = nowMs;
  syncPromise = (async () => {
    try {
      const res = await api.get('/health', { timeout: SYNC_TIMEOUT_MS });
      const bodyTime = typeof res.data?.timestamp === 'string' ? new Date(res.data.timestamp).getTime() : NaN;
      const headerTime = res.headers?.['date'] ? new Date(res.headers['date']).getTime() : NaN;
      const serverMs = Number.isFinite(bodyTime) ? bodyTime : headerTime;
      if (Number.isFinite(serverMs)) {
        offsetMs = serverMs - Date.now();
      }
    } catch {
      // 网络异常 / 服务不可达：保持现有 offset（初值 0 = 本机时间），下一轮重试
    } finally {
      syncPromise = null;
    }
  })();
  return syncPromise;
}

/**
 * 当前服务端时间（毫秒时间戳）。
 * 每次调用顺手触发一次懒同步（带缓存与去重），调用方无需手动管理同步。
 */
export function serverNow(): number {
  void syncServerTime();
  return Date.now() + offsetMs;
}

interface ExamTimeInput {
  startTime?: string | null;
  endTime?: string | null;
  durationMinutes?: number | null;
  batch?: {
    examMode?: string | null;
    startTime?: string | null;
    endTime?: string | null;
    examDuration?: number | null;
    waitingTime?: number | null;
    lateTolerance?: number | null;
  } | null;
}

/**
 * 计算最晚进入考场时间（固定时间戳，毫秒）。
 *
 * - unified（集中统一）：startTime + lateTolerance（迟到截止时间）
 * - flexible（随到随考）：endTime - examDuration（必须留出完整考试时长）
 *
 * 返回 null 表示无明确的最晚入场约束。
 */
export function computeLatestEntryTime(exam: ExamTimeInput): number | null {
  const batch = exam.batch;
  const examMode = batch?.examMode || 'unified';

  if (examMode === 'flexible') {
    const end = batch?.endTime ? new Date(batch.endTime).getTime() : null;
    if (!end) return null;
    const duration = batch?.examDuration || exam.durationMinutes || 0;
    if (duration <= 0) return end;
    return end - duration * 60 * 1000;
  }

  // unified：以考试自身开始时间为准（与 ExamEntrySteps / start-wps 一致）
  const start = exam.startTime ? new Date(exam.startTime).getTime() : null;
  if (!start) return null;
  const lateTolerance = batch?.lateTolerance || 0;
  return start + lateTolerance * 60 * 1000;
}

/**
 * 计算考试截止时间（固定时间戳，毫秒）。
 *
 * 作为入场界面（ExamEntrySteps）与答题界面（WpsExamDoing）倒计时的唯一来源，
 * 保证两者剩余时间始终一致：
 * - 优先用 exam.endTime（考试结束时间；服务端 autoEndExpiredExams 按此收卷）
 * - 其次用 startTime + effectiveDuration（effectiveDuration = batch.examDuration || durationMinutes）
 *
 * 注意：不基于 submission.startedAt 计算，避免中途入场/断点续考时
 * 剩余时间被重置为满时长——考试时间按考试结束时刻计时，而非每人独立计时。
 *
 * 返回 null 表示无法确定截止时间。
 */
export function computeExamDeadline(exam: ExamTimeInput): number | null {
  const effectiveDuration = exam.batch?.examDuration || exam.durationMinutes || 0;
  if (exam.endTime) {
    return new Date(exam.endTime).getTime();
  }
  if (exam.startTime && effectiveDuration > 0) {
    return new Date(exam.startTime).getTime() + effectiveDuration * 60 * 1000;
  }
  return null;
}

