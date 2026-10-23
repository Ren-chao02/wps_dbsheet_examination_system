/**
 * 发布预检：不满足硬约束必须阻断，且不得把考试状态改成 published。
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

// vi.mock 的工厂会被提升到文件顶部执行，工厂引用的变量必须同样提升（vi.hoisted），
// 否则会在模块初始化前访问到 TDZ 里的 const 而直接抛 ReferenceError。
const {
  preflightMock, enqueueMock, examFindUnique, examUpdate,
  examRoomStudentFindMany, tableFindMany, generationUpsert, generationUpdate,
} = vi.hoisted(() => ({
  preflightMock: vi.fn(),
  enqueueMock: vi.fn(),
  examFindUnique: vi.fn(),
  examUpdate: vi.fn(),
  examRoomStudentFindMany: vi.fn(),
  tableFindMany: vi.fn(),
  generationUpsert: vi.fn(),
  generationUpdate: vi.fn(),
}));

vi.mock('../../services/paper-preflight', () => ({ preflightExamPaper: preflightMock }));

vi.mock('../../jobs/paper-generation-queue', () => ({ enqueuePaperGeneration: enqueueMock }));

vi.mock('../../config/prisma', () => ({
  prisma: {
    exam: { findUnique: examFindUnique, update: examUpdate },
    examRoomStudent: { findMany: examRoomStudentFindMany },
    examTableAssignment: { findMany: tableFindMany },
    examPaperGeneration: { upsert: generationUpsert, update: generationUpdate },
  },
}));
vi.mock('../../services/data-scope', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, assertPaperRead: vi.fn(), questionWhere: vi.fn(() => ({})), questionPoolWhereForPaper: vi.fn(() => ({})) };
});

import { examRouter } from '../exams';

const app = express();
app.use(express.json());
app.use('/api/exams', examRouter);

const examRow = {
  id: 'e-1', title: '期中', startTime: null, status: 'draft', paperId: 'p-1', createdBy: 't-1',
  _count: { examQuestions: 2 }, paper: { _count: { paperQuestions: 2 } }, batch: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  examFindUnique.mockResolvedValue(examRow);
  examRoomStudentFindMany.mockResolvedValue([{ studentId: 's-1' }, { studentId: 's-2' }]);
  tableFindMany.mockResolvedValue([{ studentId: 's-1' }, { studentId: 's-2' }]);
  generationUpsert.mockResolvedValue({});
  enqueueMock.mockResolvedValue({ queued: true });
});

describe('POST /api/exams/:id/publish —— 组卷预检', () => {
  it('预检不通过 → 400 + preflight，且不发布', async () => {
    preflightMock.mockResolvedValue({ ok: false, issues: [{ slotIndex: 1, reason: '候选池为空', candidates: 0, signatureConflict: false }] });
    const res = await request(app).post('/api/exams/e-1/publish');
    expect(res.status).toBe(400);
    expect(res.body.preflight).toEqual([{ slotIndex: 1, reason: '候选池为空', candidates: 0, signatureConflict: false }]);
    expect(examUpdate).not.toHaveBeenCalled();
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it('预检通过 → 发布 + 建状态行 + 入队', async () => {
    preflightMock.mockResolvedValue({ ok: true, issues: [] });
    examUpdate.mockResolvedValue({ ...examRow, status: 'published' });
    const res = await request(app).post('/api/exams/e-1/publish');
    expect(res.status).toBe(200);
    expect(res.body.paperGeneration).toEqual({ status: 'pending' });
    expect(generationUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { examId: 'e-1' },
      create: expect.objectContaining({ examId: 'e-1', status: 'pending', totalStudents: 2 }),
    }));
    expect(enqueueMock).toHaveBeenCalledWith('e-1');
  });

  it('队列不可用 → 仍发布，但状态标 failed', async () => {
    preflightMock.mockResolvedValue({ ok: true, issues: [] });
    examUpdate.mockResolvedValue({ ...examRow, status: 'published' });
    enqueueMock.mockResolvedValue({ queued: false });
    const res = await request(app).post('/api/exams/e-1/publish');
    expect(res.status).toBe(200);
    expect(res.body.paperGeneration).toEqual({ status: 'failed' });
    // 先 upsert(pending)，队列不可用后再 update 成 failed
    expect(generationUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'failed' }),
    }));
  });
});
