import { prisma } from '../config/prisma';
import { Prisma } from '@prisma/client';

/**
 * 构建学生侧考试可见性过滤条件（OR 分支）。
 * 用于学生考试列表、首页统计、成绩查询等处，保证口径一致，避免多处复制导致不同步。
 *
 * 可见条件（满足任一即可）：
 * - 无批次：直接放行
 * - 批次为 active：考试进行中
 * - 批次为 completed：考试已结束（用于查看成绩/待评分，避免批次结束后学生看不到历史考试）
 * - 该学生已有提交记录：无论批次状态如何都放行（覆盖批次被归档等情况）
 *
 * 注意：调用方需自行叠加 exam.status 过滤（通常为 published/in_progress/ended）。
 */
export function studentExamVisibilityOR(studentId: string): Prisma.ExamWhereInput[] {
  return [
    { batchId: null },
    { batch: { status: 'active' } },
    { batch: { status: 'completed' } },
    { submissions: { some: { studentId } } },
  ];
}

/**
 * 全局状态兜底：考试结束时强制回收所有"考试中"的提交。
 *
 * 设计约束：任何把 exam.status 变为 'ended' 的代码路径（scheduler 自动结束、
 * 教师手动收卷、批次级联结束、列表查询兜底）都必须调用此函数，从底层杜绝
 * "考试已结束但学生端永远显示考试中"的脏数据。
 *
 * 标记 isAutoSubmitted=true 以区分主动交卷与系统超时代交，方便后续异常排查。
 *
 * @param examId 考试 ID
 * @param submittedAt 代交时间戳（通常用 exam.endTime，保留原始结束时刻）
 * @returns 收尾的 submission 数量
 */
export async function finalizeExamSubmissions(
  examId: string,
  submittedAt: Date,
): Promise<number> {
  const result = await prisma.studentSubmission.updateMany({
    where: { examId, status: 'in_progress' },
    data: {
      status: 'submitted',
      submittedAt,
      isAutoSubmitted: true,
    },
  });
  return result.count;
}

/**
 * 自动将已过期的进行中考试状态更新为"已结束"
 * 在查询考试列表/详情时调用，确保过期考试状态及时更新
 *
 * 关键：同时收尾该考试下所有 in_progress 的学生提交（submission），
 * 标记为 submitted（系统自动收卷），submittedAt 使用 exam.endTime。
 * 否则学生端会永远显示"考试中"，即使考试早已结束。
 */
export async function autoEndExpiredExams(): Promise<void> {
  const now = new Date();
  try {
    // 先查出需要自动结束的考试（含 endTime，用于 submission 的 submittedAt）
    const expiredExams = await prisma.exam.findMany({
      where: {
        status: 'in_progress',
        endTime: { lt: now },
      },
      select: { id: true, endTime: true },
    });

    if (expiredExams.length === 0) return;

    const ids = expiredExams.map(e => e.id);

    await prisma.exam.updateMany({
      where: { id: { in: ids } },
      data: { status: 'ended' },
    });

    // 级联更新相关考场分配状态为已完成
    await prisma.examRoomAssignment.updateMany({
      where: {
        examId: { in: ids },
        status: 'in_progress',
      },
      data: { status: 'completed' },
    });

    // 收尾 in_progress 的学生提交（系统自动收卷），避免学生端永远显示"考试中"
    for (const exam of expiredExams) {
      await finalizeExamSubmissions(exam.id, exam.endTime ?? now);
    }
  } catch {
    // 静默失败，不影响主流程
  }
}
