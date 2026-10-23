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
  genFindUnique, genDeleteMany, genCreate, genUpdate,
  studentCount, sqFindMany, sqDeleteMany, submissionCount, examFindUnique,
} = vi.hoisted(() => ({
  preflightMock: vi.fn(),
  enqueueMock: vi.fn(),
  genFindUnique: vi.fn(),
  genDeleteMany: vi.fn(),
  genCreate: vi.fn(),
  genUpdate: vi.fn(),
  studentCount: vi.fn(),
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
vi.mock('../../config/prisma', () => ({
  prisma: {
    exam: { findUnique: examFindUnique },
    examPaperGeneration: { findUnique: genFindUnique, deleteMany: genDeleteMany, create: genCreate, update: genUpdate },
    examRoomStudent: { count: studentCount },
    studentExamQuestion: { findMany: sqFindMany, deleteMany: sqDeleteMany },
    studentSubmission: { count: submissionCount },
  },
}));

import { examRouter } from '../exams';

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
  sqFindMany.mockResolvedValue([{ studentId: 's-1' }, { studentId: 's-2' }]);
  submissionCount.mockResolvedValue(0);
  enqueueMock.mockResolvedValue({ queued: true });
  genDeleteMany.mockResolvedValue({ count: 0 });
  genCreate.mockResolvedValue({});
  genUpdate.mockResolvedValue({});
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
    expect(enqueueMock).toHaveBeenCalledWith('e-1');
  });

  it('无提交 → 重新组卷：预检 + 清空快照 + 重建状态行 + 入队', async () => {
    submissionCount.mockResolvedValue(0);
    const res = await request(app).post('/api/exams/e-1/paper-generation/retry');
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe('regenerate');
    expect(preflightMock).toHaveBeenCalledWith('e-1');
    expect(sqDeleteMany).toHaveBeenCalledWith({ where: { examId: 'e-1' } });
    expect(genCreate).toHaveBeenCalledWith({
      data: { examId: 'e-1', status: 'pending', totalStudents: 10 },
    });
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

  it('队列不可用 → 503 且状态行标 failed（开考现场生成兜底）', async () => {
    enqueueMock.mockResolvedValue({ queued: false });
    const res = await request(app).post('/api/exams/e-1/paper-generation/retry');
    expect(res.status).toBe(503);
    expect(genUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { examId: 'e-1' },
      data: expect.objectContaining({ status: 'failed' }),
    }));
  });
});
