/**
 * WPS 表格分配的数据范围回归测试（P1）：
 * 非考试创建者/监考者不得读取、覆盖、删除他人考试的表格分配。
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
      const userId = (req.headers['x-test-user'] as string) || 'u-1';
      req.user = { id: userId, userId, username: userId, role, permissions: [] };
      next();
    },
  };
});

// 结束锁需要查考试状态，与本测试无关 → 直接放行
vi.mock('../../middleware/exam-lock', () => ({
  rejectExamConfigMutationWhenEnded: () => (_req: any, _res: any, next: any) => next(),
}));

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    exam: { findUnique: vi.fn() },
    examTableAssignment: { findMany: vi.fn(), deleteMany: vi.fn(), createMany: vi.fn() },
  } as any,
}));
vi.mock('../../config/prisma', () => ({ prisma: mockPrisma }));

import { examTableAssignmentRouter } from '../exam-table-assignments';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/exam-table-assignments', examTableAssignmentRouter);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  // t-1 创建、t-2 无关
  mockPrisma.exam.findUnique.mockResolvedValue({ createdBy: 't-1', assignments: [] });
  mockPrisma.examTableAssignment.findMany.mockResolvedValue([]);
});

describe('非本人考试 → 403', () => {
  it('GET /:examId', async () => {
    const res = await request(makeApp())
      .get('/api/exam-table-assignments/exam-1')
      .set('x-test-role', 'teacher')
      .set('x-test-user', 't-2');
    expect(res.status).toBe(403);
    expect(mockPrisma.examTableAssignment.findMany).not.toHaveBeenCalled();
  });

  it('POST /:examId/bulk', async () => {
    const res = await request(makeApp())
      .post('/api/exam-table-assignments/exam-1/bulk')
      .set('x-test-role', 'teacher')
      .set('x-test-user', 't-2')
      .send({ items: [{ studentId: 's-1', shareUrl: 'https://kdocs.cn/l/abc', accessToken: 'tok' }] });
    expect(res.status).toBe(403);
    expect(mockPrisma.examTableAssignment.createMany).not.toHaveBeenCalled();
  });

  it('DELETE /:examId/:studentId', async () => {
    const res = await request(makeApp())
      .delete('/api/exam-table-assignments/exam-1/s-1')
      .set('x-test-role', 'teacher')
      .set('x-test-user', 't-2');
    expect(res.status).toBe(403);
    expect(mockPrisma.examTableAssignment.deleteMany).not.toHaveBeenCalled();
  });
});

describe('考试创建者 → 放行', () => {
  it('GET /:examId 返回分配列表', async () => {
    const res = await request(makeApp())
      .get('/api/exam-table-assignments/exam-1')
      .set('x-test-role', 'teacher')
      .set('x-test-user', 't-1');
    expect(res.status).toBe(200);
    expect(res.body.assignments).toEqual([]);
  });
});
