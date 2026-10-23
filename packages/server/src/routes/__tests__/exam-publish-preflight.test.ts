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
  examRoomStudentFindMany, tableFindMany, generationUpsert, generationUpdateMany,
} = vi.hoisted(() => ({
  preflightMock: vi.fn(),
  enqueueMock: vi.fn(),
  examFindUnique: vi.fn(),
  examUpdate: vi.fn(),
  examRoomStudentFindMany: vi.fn(),
  tableFindMany: vi.fn(),
  generationUpsert: vi.fn(),
  generationUpdateMany: vi.fn(),
}));

vi.mock('../../services/paper-preflight', () => ({ preflightExamPaper: preflightMock }));

vi.mock('../../jobs/paper-generation-queue', () => ({ enqueuePaperGeneration: enqueueMock }));

vi.mock('../../config/prisma', () => ({
  prisma: {
    exam: { findUnique: examFindUnique, update: examUpdate },
    examRoomStudent: { findMany: examRoomStudentFindMany },
    examTableAssignment: { findMany: tableFindMany },
    examPaperGeneration: { upsert: generationUpsert, updateMany: generationUpdateMany },
  },
}));
vi.mock('../../services/data-scope', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, assertPaperRead: vi.fn(), questionWhere: vi.fn(() => ({})), questionPoolWhereForPaper: vi.fn(() => ({})) };
});
// 路由 catch 分支会打 logger.error；替换掉避免目标测试往 stdout 刷整段结构化 ERROR
vi.mock('../../utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));

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
  generationUpdateMany.mockResolvedValue({ count: 1 });
  enqueueMock.mockResolvedValue({ queued: true });
});

describe('POST /api/exams/:id/publish —— 组卷预检', () => {
  it('预检不通过 → 400 + preflight，且不发布', async () => {
    preflightMock.mockResolvedValue({ ok: false, issues: [{ slotIndex: 1, reason: '候选池为空', candidates: 0, signatureConflict: false }] });
    const res = await request(app).post('/api/exams/e-1/publish');
    expect(res.status).toBe(400);
    expect(res.body.preflight).toEqual([{ slotIndex: 1, reason: '候选池为空', candidates: 0, signatureConflict: false }]);
    // 前端 Task 7 之前只显示 message：首条原因必须已经拼进去，教师才知道该修什么
    expect(res.body.message).toContain('候选池为空');
    expect(res.body.message).toContain('共 1 项');
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

  it('同一学生分到两个考场 → totalStudents 去重', async () => {
    preflightMock.mockResolvedValue({ ok: true, issues: [] });
    examUpdate.mockResolvedValue({ ...examRow, status: 'published' });
    // 唯一键是 assignmentId+studentId：同一学生进两个考场会返回两行，不去重会把总数算大
    examRoomStudentFindMany.mockResolvedValue([
      { studentId: 's-1' }, { studentId: 's-1' }, { studentId: 's-2' },
    ]);
    const res = await request(app).post('/api/exams/e-1/publish');
    expect(res.status).toBe(200);
    expect(generationUpsert.mock.calls[0][0].update.totalStudents).toBe(2);
  });

  it('队列不可用 → 仍发布，但状态标 failed', async () => {
    preflightMock.mockResolvedValue({ ok: true, issues: [] });
    examUpdate.mockResolvedValue({ ...examRow, status: 'published' });
    enqueueMock.mockResolvedValue({ queued: false });
    const res = await request(app).post('/api/exams/e-1/publish');
    expect(res.status).toBe(200);
    expect(res.body.paperGeneration).toEqual({ status: 'failed' });
    // 先 upsert(pending)，队列不可用后再 updateMany 成 failed。
    // scheduler 统一用带 status:'pending' 守卫的 updateMany：迟到 job 已写成 done 时不倒回 failed
    expect(generationUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { examId: 'e-1', status: 'pending' },
      data: expect.objectContaining({ status: 'failed' }),
    }));
  });

  it('入队抛异常 → 发布仍 200（不 500），状态标 failed，考试已发布', async () => {
    preflightMock.mockResolvedValue({ ok: true, issues: [] });
    examUpdate.mockResolvedValue({ ...examRow, status: 'published' });
    enqueueMock.mockRejectedValue(new Error('redis down'));
    const res = await request(app).post('/api/exams/e-1/publish');
    expect(res.status).toBe(200);
    expect(res.body.paperGeneration).toEqual({ status: 'failed' });
    expect(examUpdate).toHaveBeenCalled();
    // upsert 成功后调度才炸：尽力把状态行标 failed（updateMany 兜住"行可能不存在"）。
    // 同样带 status:'pending' 守卫：迟到的 job 已写成 done 时不能倒回 failed
    expect(generationUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { examId: 'e-1', status: 'pending' },
      data: expect.objectContaining({ status: 'failed' }),
    }));
  });
});
