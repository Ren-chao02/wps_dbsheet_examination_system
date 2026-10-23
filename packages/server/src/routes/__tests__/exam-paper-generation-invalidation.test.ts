/**
 * 发布后题位变化 → 未开考快照失效 + 重新调度预生成。
 *
 * 预生成把「卷子固化的时刻」从开考提前到发布后，因此换卷/解绑/手工改题之后
 * 必须让未开考学生的快照失效并重排 job；否则 generateStudentPaper 的幂等早退
 * 会让 job 空转，学生静默拿到旧卷。
 *
 * 同时锁定「只改标题」不得误触发（Task 10 的回归：paperId ?? null 曾把普通编辑
 * 当成解绑，删光题位），以及与开考提交共存的原子守卫（student.submissions.none）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

vi.mock('../../middleware/auth', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    authenticate: (req: any, _res: any, next: any) => {
      req.user = { id: 't-1', userId: 't-1', username: 't-1', role: 'teacher', permissions: [], departmentId: 'd-1' };
      next();
    },
  };
});

const {
  examFindUnique, examUpdate,
  examQuestionDeleteMany, examQuestionCreateMany,
  questionFindMany, paperFindUnique, paperQuestionFindMany,
  sqDeleteMany, studentGroupBy, genUpsert, genUpdateMany,
  enqueueMock,
} = vi.hoisted(() => ({
  examFindUnique: vi.fn(),
  examUpdate: vi.fn(),
  examQuestionDeleteMany: vi.fn(),
  examQuestionCreateMany: vi.fn(),
  questionFindMany: vi.fn(),
  paperFindUnique: vi.fn(),
  paperQuestionFindMany: vi.fn(),
  sqDeleteMany: vi.fn(),
  studentGroupBy: vi.fn(),
  genUpsert: vi.fn(),
  genUpdateMany: vi.fn(),
  enqueueMock: vi.fn(),
}));

// 只替换入队，保留真实的 lifecycle（由下面的 prisma mock 驱动）
vi.mock('../../jobs/paper-generation-queue', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, enqueuePaperGeneration: enqueueMock };
});
vi.mock('../../config/prisma', () => {
  const prismaMock: any = {
    exam: { findUnique: examFindUnique, update: examUpdate },
    examQuestion: { deleteMany: examQuestionDeleteMany, createMany: examQuestionCreateMany },
    question: { findMany: questionFindMany },
    paper: { findUnique: paperFindUnique },
    paperQuestion: { findMany: paperQuestionFindMany },
    studentExamQuestion: { deleteMany: sqDeleteMany },
    examRoomStudent: { groupBy: studentGroupBy },
    examPaperGeneration: { upsert: genUpsert, updateMany: genUpdateMany },
  };
  // 换卷/改题的题位重建 + 快照失效在事务内取考试锁：
  // $transaction 把 mock 自身当 tx 传回，$executeRaw 校验当前确实处于事务上下文 ——
  // 将来若把 lockExam 挪到事务外，这里会直接抛错让用例失败。
  const txState = { inTx: false };
  prismaMock.$transaction = vi.fn(async (fn: any) => {
    txState.inTx = true;
    try { return await fn(prismaMock); } finally { txState.inTx = false; }
  });
  prismaMock.$executeRaw = vi.fn(async () => {
    if (!txState.inTx) throw new Error('lockExam must be called inside a transaction');
    return 1;
  });
  return { prisma: prismaMock };
});
vi.mock('../../utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

import { examRouter } from '../exams';
import { prisma } from '../../config/prisma';

const app = express();
app.use(express.json());
app.use('/api/exams', examRouter);

const NEW_PAPER = '55555555-5555-4555-8555-555555555555';

const examRow = (status = 'published', paperId: string | null = 'p-old') => ({
  id: 'e-1', title: '期中', status, paperId, createdBy: 't-1',
  batchId: null, startTime: null, endTime: null, durationMinutes: 60,
});

beforeEach(() => {
  vi.clearAllMocks();
  examFindUnique.mockResolvedValue(examRow());
  examUpdate.mockImplementation(async (args: any) => ({ id: args.where.id, ...args.data }));
  // assertPaperRead 与 syncPaperIntoExam 共用：池内（本院系）+ 难度目标
  paperFindUnique.mockResolvedValue({ createdBy: 't-1', departmentId: 'd-1', sharedToSchool: false, difficultyTarget: null });
  paperQuestionFindMany.mockResolvedValue([]);
  examQuestionDeleteMany.mockResolvedValue({ count: 0 });
  examQuestionCreateMany.mockResolvedValue({ count: 0 });
  questionFindMany.mockResolvedValue([]);
  sqDeleteMany.mockResolvedValue({ count: 3 });
  studentGroupBy.mockResolvedValue(Array.from({ length: 10 }, (_, i) => ({ studentId: `s-${i}` })));
  genUpsert.mockResolvedValue({});
  genUpdateMany.mockResolvedValue({ count: 1 });
  enqueueMock.mockResolvedValue({ queued: true });
});

describe('PUT /api/exams/:id —— 换卷/解绑后的预生成失效', () => {
  it('换到新试卷 → 未开考快照失效（含开考原子守卫）+ 状态行置 pending + 重新入队', async () => {
    // 换卷事务在 sync 之后会重读考试行；第一次是 handler 预读，之后返回落库后的值。
    // 响应必须是重读的行——sync 前的 update 行里没有 totalScore/difficultyTarget。
    let examReads = 0;
    examFindUnique.mockImplementation(async () => {
      examReads += 1;
      return examReads === 1
        ? examRow()
        : { ...examRow('published', NEW_PAPER), totalScore: 0, difficultyTarget: null };
    });

    const res = await request(app)
      .put('/api/exams/e-1')
      .send({ title: '期中', paperId: NEW_PAPER });

    expect(res.status).toBe(200);
    // 换卷写入新 paperId（普通编辑不回写预读旧值由另一条用例锁定）
    expect(examUpdate.mock.calls[0][0].data.paperId).toBe(NEW_PAPER);
    // 响应回填 sync 之后的行
    expect(res.body.paperId).toBe(NEW_PAPER);
    expect(res.body.totalScore).toBe(0);
    // sync 重建题位 + 失效旧快照同事务持考试锁（与开考事务互斥）
    expect((prisma as any).$transaction).toHaveBeenCalled();
    expect((prisma as any).$executeRaw).toHaveBeenCalled();
    // 先同步题位（换卷）
    expect(examQuestionDeleteMany).toHaveBeenCalledWith({ where: { examId: 'e-1' } });
    // 快照失效必须带原子守卫：已有开考提交的学生绝不能被删
    expect(sqDeleteMany).toHaveBeenCalledWith({
      where: {
        examId: 'e-1',
        student: {
          submissions: {
            none: { examId: 'e-1', status: { in: ['in_progress', 'submitted', 'grading', 'graded'] } },
          },
        },
      },
    });
    expect(genUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { examId: 'e-1' },
      create: expect.objectContaining({ examId: 'e-1', status: 'pending', totalStudents: 10 }),
      update: expect.objectContaining({ status: 'pending', totalStudents: 10 }),
    }));
    expect(enqueueMock).toHaveBeenCalledWith('e-1');
  });

  it('只改标题（考试已绑卷）→ 不删快照、不重排（Task 10 的解绑误判回归）', async () => {
    const res = await request(app)
      .put('/api/exams/e-1')
      .send({ title: '只改标题' });

    expect(res.status).toBe(200);
    expect(examQuestionDeleteMany).not.toHaveBeenCalled();
    expect(sqDeleteMany).not.toHaveBeenCalled();
    expect(genUpsert).not.toHaveBeenCalled();
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it('草稿考试换卷 → 照样失效（删 0 行），但 reschedule skipped（不建状态行/不入队）', async () => {
    examFindUnique.mockResolvedValue(examRow('draft', null));

    const res = await request(app)
      .put('/api/exams/e-1')
      .send({ title: '期中', paperId: NEW_PAPER });

    expect(res.status).toBe(200);
    expect(sqDeleteMany).toHaveBeenCalledTimes(1);
    expect(genUpsert).not.toHaveBeenCalled();
    expect(enqueueMock).not.toHaveBeenCalled();
  });
});

describe('PUT /api/exams/:id/questions —— 手工改题后的预生成失效', () => {
  it('替换题目 → 快照失效并重新入队', async () => {
    const res = await request(app)
      .put('/api/exams/e-1/questions')
      .send({ questionIds: [] });

    expect(res.status).toBe(200);
    // 题位重建 + 快照失效同事务持考试锁
    expect((prisma as any).$transaction).toHaveBeenCalled();
    expect((prisma as any).$executeRaw).toHaveBeenCalled();
    expect(examQuestionDeleteMany).toHaveBeenCalledWith({ where: { examId: 'e-1' } });
    expect(sqDeleteMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        examId: 'e-1',
        student: { submissions: { none: expect.objectContaining({ examId: 'e-1' }) } },
      }),
    }));
    expect(genUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { examId: 'e-1' },
      update: expect.objectContaining({ status: 'pending' }),
    }));
    expect(enqueueMock).toHaveBeenCalledWith('e-1');
  });
});
