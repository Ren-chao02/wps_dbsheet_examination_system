/**
 * 行为日志/分析报告的数据范围回归测试（P1）：
 * 教师只能查「我创建/监考」考试的考生行为数据；范围外考试直接 403。
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

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    studentBehaviorLog: { findMany: vi.fn(), count: vi.fn() },
    behaviorAnalysisReport: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    exam: { findUnique: vi.fn(), findMany: vi.fn() },
  } as any,
}));
vi.mock('../../config/prisma', () => ({ prisma: mockPrisma }));

import { behaviorRouter } from '../behaviors';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/behaviors', behaviorRouter);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.studentBehaviorLog.findMany.mockResolvedValue([]);
  mockPrisma.studentBehaviorLog.count.mockResolvedValue(0);
});

describe('GET /api/behaviors 列表', () => {
  it('教师指定范围外考试 → 403', async () => {
    mockPrisma.exam.findUnique.mockResolvedValue({ createdBy: 't-1', assignments: [] });
    const res = await request(makeApp())
      .get('/api/behaviors?examId=00000000-0000-4000-8000-000000000001')
      .set('x-test-role', 'teacher')
      .set('x-test-user', 't-2');
    expect(res.status).toBe(403);
    expect(mockPrisma.studentBehaviorLog.findMany).not.toHaveBeenCalled();
  });

  it('教师不指定考试 → 自动限定在可见考试内', async () => {
    mockPrisma.exam.findMany.mockResolvedValue([{ id: 'e-1' }]);
    const res = await request(makeApp())
      .get('/api/behaviors')
      .set('x-test-role', 'teacher')
      .set('x-test-user', 't-2');
    expect(res.status).toBe(200);
    const where = mockPrisma.studentBehaviorLog.findMany.mock.calls[0][0].where;
    expect(where.AND[0]).toEqual({ examId: { in: ['e-1'] } });
  });
});

describe('报告与审核接口', () => {
  // 路径参数须为合法 UUID：非 UUID 现在由参数校验层拦为 400（见 behaviors-params.test.ts），
  // 本组用例要测的是「归属校验 403」，所以这里用真实形态的 id。
  const EXAM_ID = '11111111-1111-4111-8111-111111111111';
  const STUDENT_ID = '22222222-2222-4222-8222-222222222222';

  beforeEach(() => {
    mockPrisma.exam.findUnique.mockResolvedValue({ createdBy: 't-1', assignments: [] });
  });

  it('GET /reports/:examId（列表）范围外 → 403', async () => {
    const res = await request(makeApp())
      .get(`/api/behaviors/reports/${EXAM_ID}`)
      .set('x-test-role', 'teacher')
      .set('x-test-user', 't-2');
    expect(res.status).toBe(403);
  });

  it('GET /reports/:examId/:studentId（单人报告）范围外 → 403', async () => {
    const res = await request(makeApp())
      .get(`/api/behaviors/reports/${EXAM_ID}/${STUDENT_ID}`)
      .set('x-test-role', 'teacher')
      .set('x-test-user', 't-2');
    expect(res.status).toBe(403);
  });

  it('PUT /reports/:examId/:studentId/review 范围外 → 403 且不改库', async () => {
    const res = await request(makeApp())
      .put(`/api/behaviors/reports/${EXAM_ID}/${STUDENT_ID}/review`)
      .set('x-test-role', 'teacher')
      .set('x-test-user', 't-2')
      .send({ conclusion: '正常' });
    expect(res.status).toBe(403);
    expect(mockPrisma.behaviorAnalysisReport.update).not.toHaveBeenCalled();
  });
});
