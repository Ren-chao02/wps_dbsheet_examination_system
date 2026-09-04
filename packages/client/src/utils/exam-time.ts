/**
 * 考试时间相关计算工具。
 * 计算口径与服务端 start-wps 入场校验（my-exams.ts）保持一致，避免前后端漂移。
 */

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

