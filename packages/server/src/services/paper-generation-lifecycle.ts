/**
 * 预生成快照的生命周期：失效与重新调度。
 *
 * 预生成把「卷子固化的时刻」从开考提前到了发布后。因此发布后的任何题位变化
 * （换卷、手工改题、解绑）都必须让未开考学生的快照失效并重新生成，否则
 * generateStudentPaper 的幂等早退会让 job 空转，学生静默拿到旧卷。
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { schedulePaperGeneration } from './paper-generation-scheduler';
import { STARTED_SUBMISSION_STATUSES } from './submission-statuses';

/** 删除未开考学生的快照（原子守卫：开考事务与快照同事务提交，单条 DELETE 的可见性即安全） */
export async function invalidateUnstartedSnapshots(
  examId: string,
  tx: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<number> {
  const res = await tx.studentExamQuestion.deleteMany({
    where: {
      examId,
      student: {
        submissions: {
          none: { examId, status: { in: [...STARTED_SUBMISSION_STATUSES] } },
        },
      },
    },
  });
  return res.count;
}

/** 去重后的名单人数（同一学生可能被分到多个考场） */
export async function countDistinctStudents(
  examId: string,
  tx: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<number> {
  const rows = await tx.examRoomStudent.groupBy({ by: ['studentId'], where: { assignment: { examId } } });
  return rows.length;
}

/**
 * 题位变化后重新调度预生成（仅对已发布/待考考试）。
 * 状态行重置/入队/failed 约定的唯一实现在 scheduler，这里只做「是否该调度」的前置判断。
 */
export async function reschedulePaperGeneration(examId: string): Promise<'skipped' | 'pending' | 'failed'> {
  const exam = await prisma.exam.findUnique({ where: { id: examId }, select: { status: true } });
  if (!exam || (exam.status !== 'published' && exam.status !== 'scheduled')) return 'skipped';
  return schedulePaperGeneration({
    examId,
    totalStudents: await countDistinctStudents(examId),
    mode: 'reset',
  });
}
