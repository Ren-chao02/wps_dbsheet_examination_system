import type { Prisma } from '@prisma/client';

/**
 * 按 examId 的 PostgreSQL 事务级 advisory lock。
 *
 * 当前四个调用点：
 * 1. 开考事务（my-exams.ts start-wps）；
 * 2. 重新组卷（exams.ts `POST /:id/paper-generation/retry`）；
 * 3. 换卷（exams.ts `PUT /:id`，paperId 变更时的 update + 题位重建 + 快照失效）；
 * 4. 手工改题（exams.ts `PUT /:id/questions`，题位重建 + 快照失效）。
 *
 * 四者都必须在事务内先取锁，再读写 ExamQuestion / StudentExamQuestion，才能消除
 * 「预生成快照被删/换题」与「学生正在开考」之间的毫秒级窗口。
 * 规则：任何改写 ExamQuestion / StudentExamQuestion 的路径都必须先取这把锁。
 * hashtextextended 返回 bigint，避免 hashtext 32 位碰撞。
 */
export async function lockExam(tx: Prisma.TransactionClient, examId: string): Promise<void> {
  // 用 $executeRaw 而非 $queryRaw：pg_advisory_xact_lock 返回 void，
  // Prisma 的 $queryRaw 无法反序列化该列（真实库实测报错）。
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${examId}, 0))`;
}
