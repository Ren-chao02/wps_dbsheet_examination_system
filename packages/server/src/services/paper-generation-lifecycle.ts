/**
 * 预生成快照的生命周期：失效与重新调度。
 *
 * 预生成把「卷子固化的时刻」从开考提前到了发布后。因此发布后的任何题位变化
 * （换卷、手工改题、解绑）都必须让未开考学生的快照失效并重新生成，否则
 * generateStudentPaper 的幂等早退会让 job 空转，学生静默拿到旧卷。
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { enqueuePaperGeneration } from '../jobs/paper-generation-queue';
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
export async function countDistinctStudents(examId: string): Promise<number> {
  const rows = await prisma.examRoomStudent.groupBy({ by: ['studentId'], where: { assignment: { examId } } });
  return rows.length;
}

/**
 * 题位变化后重新调度预生成（仅对已发布/待考考试）。
 * 清空上一轮 summary/时间戳再入队；队列不可用标 failed（开考现场生成兜底）。
 */
export async function reschedulePaperGeneration(examId: string): Promise<'skipped' | 'queued' | 'failed'> {
  const exam = await prisma.exam.findUnique({ where: { id: examId }, select: { status: true } });
  if (!exam || (exam.status !== 'published' && exam.status !== 'scheduled')) return 'skipped';
  const totalStudents = await countDistinctStudents(examId);
  await prisma.examPaperGeneration.upsert({
    where: { examId },
    create: { examId, status: 'pending', totalStudents },
    update: {
      status: 'pending', totalStudents,
      queuedAt: new Date(), startedAt: null, finishedAt: null, error: null,
      summary: Prisma.JsonNull, unfilledSlots: Prisma.JsonNull,
    },
  });
  const enq = await enqueuePaperGeneration(examId);
  if (!enq.queued) {
    await prisma.examPaperGeneration.updateMany({
      where: { examId, status: 'pending' },
      data: { status: 'failed', error: '组卷队列不可用（Redis 未启动）；开考时将现场生成' },
    });
    return 'failed';
  }
  return 'queued';
}
