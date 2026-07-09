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
 * 自动将已过期的进行中考试状态更新为"已结束"
 * 在查询考试列表/详情时调用，确保过期考试状态及时更新
 */
export async function autoEndExpiredExams(): Promise<void> {
  const now = new Date();
  try {
    // 先查出需要自动结束的考试 ID，再执行更新
    const expiredExamIds = await prisma.exam.findMany({
      where: {
        status: 'in_progress',
        endTime: { lt: now },
      },
      select: { id: true },
    });

    if (expiredExamIds.length === 0) return;

    const ids = expiredExamIds.map(e => e.id);

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
  } catch {
    // 静默失败，不影响主流程
  }
}
