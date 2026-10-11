/**
 * 客观题作答接口回归测试
 *
 * 交付前的端到端验证已跑通（纯客观题考试开考 → 作答 → 交卷 → 判分 10/10 与 5/10），
 * 这里把其中最容易被改坏的三条约束固化成单测：
 *   - 交卷后不能再改作答（否则成绩可被事后篡改）
 *   - 不能给"不属于自己卷子"的题目作答（抽题组卷下每人题目不同，越权作答=作弊）
 *   - 未开考（没有答题记录）不接受作答
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
      req.user = { id: 'stu-1', userId: 'stu-1', username: 'stu-1', role, permissions: [] };
      next();
    },
  };
});

vi.mock('../../services/wps-config-service', () => ({
  wpsConfigService: { get: vi.fn().mockResolvedValue(null), getValidAccessToken: vi.fn().mockResolvedValue(null) },
}));
vi.mock('../../services/wps-table-service', () => ({ loadTablePreview: vi.fn() }));
vi.mock('../../services/paper-generator', () => ({
  generateStudentPaper: vi.fn().mockResolvedValue({ created: 0, total: 0, unfilledSlots: [] }),
}));

const { mockPrisma } = vi.hoisted(() => {
  const prisma: any = {
    exam: { findUnique: vi.fn(), findFirst: vi.fn() },
    examQuestion: { findMany: vi.fn() },
    studentSubmission: { findUnique: vi.fn(), updateMany: vi.fn() },
    studentExamQuestion: { findMany: vi.fn(), count: vi.fn(), createMany: vi.fn(), groupBy: vi.fn() },
    submissionDetail: { updateMany: vi.fn() },
    examTableAssignment: { findUnique: vi.fn() },
    $transaction: vi.fn((ops: any) => (Array.isArray(ops) ? Promise.all(ops) : ops(mockPrisma))),
  };
  return { mockPrisma: prisma };
});
vi.mock('../../config/prisma', () => ({ prisma: mockPrisma }));

import { myExamRouter } from '../my-exams';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/my-exams', myExamRouter);
  return app;
}

const Q_A = '11111111-1111-4111-8111-111111111111';
const Q_B = '22222222-2222-4222-8222-222222222222';
const Q_FOREIGN = '33333333-3333-4333-8333-333333333333';

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.studentSubmission.findUnique.mockResolvedValue({ id: 'sub-1', status: 'in_progress' });
  // 该生卷子只含 Q_A / Q_B
  mockPrisma.studentExamQuestion.findMany.mockResolvedValue([
    { questionId: Q_A }, { questionId: Q_B },
  ]);
  mockPrisma.submissionDetail.updateMany.mockResolvedValue({ count: 1 });
});

describe('PUT /my-exams/:id/answers', () => {
  it('保存本人卷子里的作答 → 成功，并写明保存条数', async () => {
    const res = await request(makeApp())
      .put('/api/my-exams/exam-1/answers')
      .set('x-test-role', 'student')
      .send({ answers: [{ questionId: Q_A, answer: 'A' }, { questionId: Q_B, answer: ['A', 'C'] }] });

    expect(res.status).toBe(200);
    expect(res.body.saved).toBe(2);
    expect(mockPrisma.submissionDetail.updateMany).toHaveBeenCalledTimes(2);
  });

  it('交卷后不可再改作答（防止成绩被事后篡改）', async () => {
    mockPrisma.studentSubmission.findUnique.mockResolvedValue({ id: 'sub-1', status: 'submitted' });

    const res = await request(makeApp())
      .put('/api/my-exams/exam-1/answers')
      .set('x-test-role', 'student')
      .send({ answers: [{ questionId: Q_A, answer: 'A' }] });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('已提交');
    expect(mockPrisma.submissionDetail.updateMany).not.toHaveBeenCalled();
  });

  it('给不属于自己卷子的题目作答 → 403，且一条都不写入', async () => {
    const res = await request(makeApp())
      .put('/api/my-exams/exam-1/answers')
      .set('x-test-role', 'student')
      .send({ answers: [{ questionId: Q_A, answer: 'A' }, { questionId: Q_FOREIGN, answer: 'A' }] });

    expect(res.status).toBe(403);
    expect(res.body.rejected).toEqual([Q_FOREIGN]);
    // 关键：整批拒绝，不能"部分写入"（否则越权者仍能蹭进一条）
    expect(mockPrisma.submissionDetail.updateMany).not.toHaveBeenCalled();
  });

  it('尚未开考（无答题记录）不接受作答', async () => {
    mockPrisma.studentSubmission.findUnique.mockResolvedValue(null);

    const res = await request(makeApp())
      .put('/api/my-exams/exam-1/answers')
      .set('x-test-role', 'student')
      .send({ answers: [{ questionId: Q_A, answer: 'A' }] });

    expect(res.status).toBe(404);
  });

  it('参数非法（questionId 不是 uuid）→ 400，不触达数据库', async () => {
    const res = await request(makeApp())
      .put('/api/my-exams/exam-1/answers')
      .set('x-test-role', 'student')
      .send({ answers: [{ questionId: 'not-a-uuid', answer: 'A' }] });

    expect(res.status).toBe(400);
    expect(mockPrisma.submissionDetail.updateMany).not.toHaveBeenCalled();
  });

  it('取消选择（answer 传 null）也应被接受', async () => {
    const res = await request(makeApp())
      .put('/api/my-exams/exam-1/answers')
      .set('x-test-role', 'student')
      .send({ answers: [{ questionId: Q_A, answer: null }] });

    expect(res.status).toBe(200);
    expect(mockPrisma.submissionDetail.updateMany).toHaveBeenCalledTimes(1);
  });
});
