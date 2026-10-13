/**
 * 考试读路径的数据范围回归测试（P1）。
 * 锁定：教师只能读「我创建/监考」的考试列表/详情/答卷/考生/排座；监考老师放行。
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

// autoEndExpiredExams 会扫全表收卷，测试里直接短路
vi.mock('../../utils/exam-utils', () => ({
  autoEndExpiredExams: vi.fn().mockResolvedValue(undefined),
  finalizeExamSubmissions: vi.fn().mockResolvedValue(undefined),
}));

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    exam: { findMany: vi.fn(), count: vi.fn(), findUnique: vi.fn() },
    studentSubmission: { groupBy: vi.fn(), findMany: vi.fn() },
    examTableAssignment: { findMany: vi.fn() },
    examRoomStudent: { findMany: vi.fn() },
  } as any,
}));
vi.mock('../../config/prisma', () => ({ prisma: mockPrisma }));

import { examRouter } from '../exams';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/exams', examRouter);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.exam.findMany.mockResolvedValue([]);
  mockPrisma.exam.count.mockResolvedValue(0);
  mockPrisma.exam.findUnique.mockResolvedValue(null);
});

describe('GET /api/exams 列表范围', () => {
  it('教师 → where 携带「我创建/我监考」OR 条件', async () => {
    const res = await request(makeApp())
      .get('/api/exams')
      .set('x-test-role', 'teacher')
      .set('x-test-user', 't-2');

    expect(res.status).toBe(200);
    const arg = mockPrisma.exam.findMany.mock.calls[0][0];
    expect(arg.where.AND[0]).toEqual({
      OR: [
        { createdBy: 't-2' },
        { assignments: { some: { invigilators: { some: { id: 't-2' } } } } },
      ],
    });
    // count 必须用同一 where，否则分页总数泄露范围外数量
    expect(mockPrisma.exam.count).toHaveBeenCalledWith({ where: arg.where });
  });

  it('admin → 无范围条件（AND 里没有 OR 段）', async () => {
    const res = await request(makeApp()).get('/api/exams').set('x-test-role', 'admin');
    expect(res.status).toBe(200);
    const arg = mockPrisma.exam.findMany.mock.calls[0][0];
    expect(arg.where.AND).toEqual([{}]);
  });
});

describe('GET /api/exams/:id 详情范围', () => {
  it('非本人考试 → 403', async () => {
    mockPrisma.exam.findUnique.mockResolvedValue({ createdBy: 't-1', assignments: [] });
    const res = await request(makeApp())
      .get('/api/exams/exam-1')
      .set('x-test-role', 'teacher')
      .set('x-test-user', 't-2');
    expect(res.status).toBe(403);
  });

  it('监考老师 → 200', async () => {
    mockPrisma.exam.findUnique.mockResolvedValue({
      id: 'exam-1',
      title: '考试',
      createdBy: 't-1',
      assignments: [{ invigilators: [{ id: 't-2' }] }],
    });
    const res = await request(makeApp())
      .get('/api/exams/exam-1')
      .set('x-test-role', 'teacher')
      .set('x-test-user', 't-2');
    expect(res.status).toBe(200);
  });
});

describe('答卷/考生/排座 范围', () => {
  beforeEach(() => {
    // 考试存在但不属于 t-2、也没安排 t-2 监考
    mockPrisma.exam.findUnique.mockResolvedValue({ createdBy: 't-1', assignments: [] });
  });

  it('GET /:id/submissions 非本人 → 403 且不查答卷', async () => {
    const res = await request(makeApp())
      .get('/api/exams/exam-1/submissions')
      .set('x-test-role', 'teacher')
      .set('x-test-user', 't-2');
    expect(res.status).toBe(403);
    expect(mockPrisma.studentSubmission.findMany).not.toHaveBeenCalled();
  });

  it('GET /:id/students 非本人 → 403', async () => {
    const res = await request(makeApp())
      .get('/api/exams/exam-1/students')
      .set('x-test-role', 'teacher')
      .set('x-test-user', 't-2');
    expect(res.status).toBe(403);
  });

  it('GET /:id/room-assignments 非本人 → 403', async () => {
    const res = await request(makeApp())
      .get('/api/exams/exam-1/room-assignments')
      .set('x-test-role', 'teacher')
      .set('x-test-user', 't-2');
    expect(res.status).toBe(403);
  });
});
