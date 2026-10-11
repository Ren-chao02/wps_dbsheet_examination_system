/**
 * 批改记录存档回归测试
 *
 * 需求：每次阅卷的批改记录要可追溯。两条保证：
 * - 判分时把「当时用的规则」快照写进 SubmissionDetail.gradedWith
 *   （题目规则日后被改，仍能复现当时是按什么规则判的分）
 * - 人工改分写 GradeReviewLog（谁、何时、原分→新分、理由）
 *
 * 这里锁死「人工改分必定留痕」这条：一旦有人把留痕删掉，测试立刻失败。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

vi.mock('../../middleware/auth', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    authenticate: (req: any, res: any, next: any) => {
      const role = req.headers['x-test-role'];
      if (!role) return res.status(401).json({ message: '未认证' });
      req.user = { id: 'teacher-1', userId: 'teacher-1', username: '张老师', role, permissions: [] };
      next();
    },
  };
});

const { mockPrisma } = vi.hoisted(() => {
  const prisma: any = {
    studentSubmission: { findUnique: vi.fn() },
    submissionDetail: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    verificationResult: { updateMany: vi.fn(), findMany: vi.fn() },
    gradeReviewLog: { create: vi.fn() },
    exam: { findUnique: vi.fn() },
    examQuestion: { findFirst: vi.fn() },
    $transaction: vi.fn(),
  };
  return { mockPrisma: prisma };
});
vi.mock('../../config/prisma', () => ({ prisma: mockPrisma }));

vi.mock('../../services/grading-service', () => ({ gradeSubmission: vi.fn() }));
vi.mock('../../jobs/grading-queue', () => ({
  enqueueGrading: vi.fn(), enqueueExamGrading: vi.fn(), enqueueExamGradingBatch: vi.fn(),
}));

import { gradingRouter } from '../grading';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/grading', gradingRouter);
  return app;
}

const DETAIL = {
  id: 'detail-1',
  submissionId: 'sub-1',
  questionId: 'q-1',
  score: 6,
  isCorrect: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  // 归属校验：submission → exam → 创建者是当前教师
  mockPrisma.studentSubmission.findUnique.mockResolvedValue({ id: 'sub-1', examId: 'exam-1', status: 'grading' });
  mockPrisma.exam.findUnique.mockResolvedValue({ id: 'exam-1', createdBy: 'teacher-1', assignments: [] });
  mockPrisma.submissionDetail.findFirst.mockResolvedValue(DETAIL);
  mockPrisma.submissionDetail.update.mockResolvedValue({ ...DETAIL, score: 8 });
  mockPrisma.gradeReviewLog.create.mockResolvedValue({ id: 'log-1' });
  // $transaction 数组形式：按顺序执行并返回结果数组
  mockPrisma.$transaction.mockImplementation(async (ops: any[]) => Promise.all(ops));
});

describe('人工改分留痕（成绩存档）', () => {
  it('教师改题分：同时写入 GradeReviewLog，记录原分→新分与理由', async () => {
    const res = await request(makeApp())
      .post('/api/grading/sub-1/detail/detail-1')
      .set('x-test-role', 'teacher')
      .send({ score: 8, isCorrect: true, reason: '学生操作正确，判分规则漏判' });

    expect(res.status).toBe(200);
    expect(mockPrisma.gradeReviewLog.create).toHaveBeenCalledTimes(1);
    const logData = mockPrisma.gradeReviewLog.create.mock.calls[0][0].data;
    expect(logData).toMatchObject({
      submissionDetailId: 'detail-1',
      submissionId: 'sub-1',
      reviewerId: 'teacher-1',
      beforeScore: 6,
      afterScore: 8,
      beforeCorrect: false,
      afterCorrect: true,
      changeType: 'detail_override',
      reason: '学生操作正确，判分规则漏判',
    });
  });

  it('改分与留痕在同一事务内（不会出现"改了分但没留痕"）', async () => {
    await request(makeApp())
      .post('/api/grading/sub-1/detail/detail-1')
      .set('x-test-role', 'teacher')
      .send({ score: 8, isCorrect: true });

    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    const ops = mockPrisma.$transaction.mock.calls[0][0];
    expect(Array.isArray(ops)).toBe(true);
    expect(ops).toHaveLength(2); // 更新分数 + 写留痕
  });

  it('学生不能给自己改分', async () => {
    const res = await request(makeApp())
      .post('/api/grading/sub-1/detail/detail-1')
      .set('x-test-role', 'student')
      .send({ score: 10, isCorrect: true });

    expect(res.status).toBe(403);
    expect(mockPrisma.gradeReviewLog.create).not.toHaveBeenCalled();
  });
});
