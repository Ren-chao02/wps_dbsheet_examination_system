/**
 * 组卷状态与重试接口：只读状态 + 「已开考只补缺、未开考才重来」的安全边界。
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
  preflightMock, enqueueMock,
  genFindUnique, genDeleteMany, genCreate, genUpdate, genUpsert, genUpdateMany,
  studentCount, studentGroupBy, sqFindMany, sqDeleteMany, submissionCount, examFindUnique,
} = vi.hoisted(() => ({
  preflightMock: vi.fn(),
  enqueueMock: vi.fn(),
  genFindUnique: vi.fn(),
  genDeleteMany: vi.fn(),
  genCreate: vi.fn(),
  genUpdate: vi.fn(),
  genUpsert: vi.fn(),
  genUpdateMany: vi.fn(),
  studentCount: vi.fn(),
  studentGroupBy: vi.fn(),
  sqFindMany: vi.fn(),
  sqDeleteMany: vi.fn(),
  submissionCount: vi.fn(),
  examFindUnique: vi.fn(),
}));

vi.mock('../../services/paper-preflight', () => ({ preflightExamPaper: preflightMock }));
// 只替换入队，保留真实的 getPaperGenerationProgress（用下面的 prisma mock 驱动）：
// 整模块替换会让路由里的 getPaperGenerationProgress 变 undefined → 500。
vi.mock('../../jobs/paper-generation-queue', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, enqueuePaperGeneration: enqueueMock };
});
vi.mock('../../config/prisma', () => {
  const prismaMock: any = {
    exam: { findUnique: examFindUnique },
    examPaperGeneration: { findUnique: genFindUnique, deleteMany: genDeleteMany, create: genCreate, update: genUpdate, upsert: genUpsert, updateMany: genUpdateMany },
    examRoomStudent: { count: studentCount, groupBy: studentGroupBy },
    studentExamQuestion: { findMany: sqFindMany, deleteMany: sqDeleteMany },
    studentSubmission: { count: submissionCount },
  };
  // 路由必须在事务内取 advisory lock：$transaction 把 mock 自己当 tx 传回，
  // $executeRaw 校验当前确实处于事务上下文 —— 将来若把 lockExam 挪到事务外，
  // 这里会直接抛错让用例失败，而不是"碰巧还能过"。
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

import { examRouter } from '../exams';
import { prisma } from '../../config/prisma';

const app = express();
app.use(express.json());
app.use('/api/exams', examRouter);

beforeEach(() => {
  vi.clearAllMocks();
  examFindUnique.mockResolvedValue({ id: 'e-1', status: 'published', paperId: 'p-1', createdBy: 't-1', assignments: [] });
  genFindUnique.mockResolvedValue({
    examId: 'e-1', status: 'done', summary: { generated: 10 }, unfilledSlots: [], error: null,
    queuedAt: new Date('2026-10-23T01:00:00Z'), startedAt: null, finishedAt: null,
  });
  studentCount.mockResolvedValue(10);
  // 进度总数走 groupBy 去重（同一学生可能被分到多个考场）
  studentGroupBy.mockResolvedValue(Array.from({ length: 10 }, (_, i) => ({ studentId: `s-${i}` })));
  sqFindMany.mockResolvedValue([{ studentId: 's-1' }, { studentId: 's-2' }]);
  submissionCount.mockResolvedValue(0);
  enqueueMock.mockResolvedValue({ queued: true });
  genDeleteMany.mockResolvedValue({ count: 0 });
  genCreate.mockResolvedValue({});
  genUpdate.mockResolvedValue({});
  genUpsert.mockResolvedValue({});
  genUpdateMany.mockResolvedValue({ count: 1 });
  sqDeleteMany.mockResolvedValue({ count: 0 });
  preflightMock.mockResolvedValue({ ok: true, issues: [] });
});

describe('GET /api/exams/:id/paper-generation', () => {
  it('返回状态、进度与汇总', async () => {
    const res = await request(app).get('/api/exams/e-1/paper-generation');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'done', totalStudents: 10, generatedStudents: 2, summary: { generated: 10 },
    });
  });
});

describe('POST /api/exams/:id/paper-generation/retry', () => {
  it('已有提交 → 只补生成，不删快照', async () => {
    submissionCount.mockResolvedValue(3);
    const res = await request(app).post('/api/exams/e-1/paper-generation/retry');
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe('fill-missing');
    expect(sqDeleteMany).not.toHaveBeenCalled();
    expect(submissionCount).toHaveBeenCalledWith({
      where: { examId: 'e-1', status: { in: ['in_progress', 'submitted', 'grading', 'graded'] } },
    });
    expect(genUpsert).toHaveBeenCalledWith(expect.objectContaining({ where: { examId: 'e-1' } }));
    expect(enqueueMock).toHaveBeenCalledWith('e-1');
  });

  it('无提交 → 重新组卷：预检 + 清空快照 + 重建状态行 + 入队', async () => {
    submissionCount.mockResolvedValue(0);
    const res = await request(app).post('/api/exams/e-1/paper-generation/retry');
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe('regenerate');
    // 决议 + 快照失效必须在事务内持考试锁（与开考事务互斥）
    expect((prisma as any).$transaction).toHaveBeenCalled();
    expect((prisma as any).$executeRaw).toHaveBeenCalled();
    expect(preflightMock).toHaveBeenCalledWith('e-1', expect.anything());
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
    expect(genUpsert).toHaveBeenCalledWith(expect.objectContaining({ where: { examId: 'e-1' } }));
    expect(enqueueMock).toHaveBeenCalledWith('e-1');
  });

  it('预检不过 → 400 + preflight，且不清空快照', async () => {
    preflightMock.mockResolvedValue({ ok: false, issues: [{ slotIndex: 2, reason: '候选池为空', candidates: 0, signatureConflict: false }] });
    const res = await request(app).post('/api/exams/e-1/paper-generation/retry');
    expect(res.status).toBe(400);
    expect(res.body.preflight).toHaveLength(1);
    expect(sqDeleteMany).not.toHaveBeenCalled();
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it('考试已结束 → 409', async () => {
    examFindUnique.mockResolvedValue({ id: 'e-1', status: 'ended', paperId: 'p-1', createdBy: 't-1', assignments: [] });
    const res = await request(app).post('/api/exams/e-1/paper-generation/retry');
    expect(res.status).toBe(409);
  });

  it('草稿考试 → 409（发布前不允许预生成，避免改卷后快照不生效）', async () => {
    examFindUnique.mockResolvedValue({ id: 'e-1', status: 'draft', createdBy: 't-1', assignments: [] });
    const res = await request(app).post('/api/exams/e-1/paper-generation/retry');
    expect(res.status).toBe(409);
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it('考试已取消 → 409', async () => {
    examFindUnique.mockResolvedValue({ id: 'e-1', status: 'cancelled', createdBy: 't-1', assignments: [] });
    const res = await request(app).post('/api/exams/e-1/paper-generation/retry');
    expect(res.status).toBe(409);
  });

  it('组卷任务正在执行 → 409（不删快照、不入队）', async () => {
    genFindUnique.mockResolvedValue({ examId: 'e-1', status: 'running' });
    const res = await request(app).post('/api/exams/e-1/paper-generation/retry');
    expect(res.status).toBe(409);
    expect(sqDeleteMany).not.toHaveBeenCalled();
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it('尚无组卷记录 → GET 返回 status:none，进度仍可读', async () => {
    genFindUnique.mockResolvedValue(null);
    const res = await request(app).get('/api/exams/e-1/paper-generation');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('none');
    expect(res.body).toMatchObject({ totalStudents: 10, generatedStudents: 2 });
  });

  it('补生成时队列不可用 → 503 且状态行标 failed', async () => {
    submissionCount.mockResolvedValue(1);
    enqueueMock.mockResolvedValue({ queued: false });
    const res = await request(app).post('/api/exams/e-1/paper-generation/retry');
    expect(res.status).toBe(503);
    // 事务外标记失败走 updateMany + status:'pending' 守卫：不能把并发重试刚置的
    // pending 误标 failed，也避免持锁期间等 Redis。
    expect(genUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { examId: 'e-1', status: 'pending' },
      data: expect.objectContaining({ status: 'failed' }),
    }));
  });

  it('队列不可用 → 503 且状态行标 failed（开考现场生成兜底）', async () => {
    enqueueMock.mockResolvedValue({ queued: false });
    const res = await request(app).post('/api/exams/e-1/paper-generation/retry');
    expect(res.status).toBe(503);
    expect(genUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { examId: 'e-1', status: 'pending' },
      data: expect.objectContaining({ status: 'failed' }),
    }));
  });
});
