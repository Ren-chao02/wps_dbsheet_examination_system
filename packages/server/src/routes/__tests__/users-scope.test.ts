/**
 * 用户列表数据范围回归测试（P1）。
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
    teacherClass: { findMany: vi.fn() },
    user: { findMany: vi.fn(), count: vi.fn(), findUnique: vi.fn() },
  } as any,
}));
vi.mock('../../config/prisma', () => ({ prisma: mockPrisma }));

import { userRouter } from '../users';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/users', userRouter);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.teacherClass.findMany.mockResolvedValue([{ classId: 'c-1' }]);
  mockPrisma.user.findMany.mockResolvedValue([]);
  mockPrisma.user.count.mockResolvedValue(0);
  mockPrisma.user.findUnique.mockResolvedValue(null);
});

describe('GET /api/users', () => {
  it('教师查学生 → 限定任教班级', async () => {
    const res = await request(makeApp())
      .get('/api/users?role=student')
      .set('x-test-role', 'teacher')
      .set('x-test-user', 't-1');
    expect(res.status).toBe(200);
    const where = mockPrisma.user.findMany.mock.calls[0][0].where;
    expect(where.AND[0]).toEqual({ role: 'student', classRoomId: { in: ['c-1'] } });
  });

  it('教师不带 role → 退化为「任教班级学生」范围，不返回全库', async () => {
    const res = await request(makeApp())
      .get('/api/users')
      .set('x-test-role', 'teacher')
      .set('x-test-user', 't-1');
    expect(res.status).toBe(200);
    const where = mockPrisma.user.findMany.mock.calls[0][0].where;
    expect(where.AND[0]).toEqual({ role: 'student', classRoomId: { in: ['c-1'] } });
  });

  it('教师查教师 → 轻量教师列表（监考人选择需要）', async () => {
    const res = await request(makeApp())
      .get('/api/users?role=teacher')
      .set('x-test-role', 'teacher')
      .set('x-test-user', 't-1');
    expect(res.status).toBe(200);
    const where = mockPrisma.user.findMany.mock.calls[0][0].where;
    expect(where.AND[0]).toEqual({ role: 'teacher' });
  });

  it('admin → 无范围条件', async () => {
    const res = await request(makeApp())
      .get('/api/users?role=student')
      .set('x-test-role', 'admin');
    expect(res.status).toBe(200);
    const where = mockPrisma.user.findMany.mock.calls[0][0].where;
    expect(where.AND[0]).toEqual({});
  });
});

describe('GET /api/users/:id', () => {
  it('教师查范围外学生 → 403', async () => {
    mockPrisma.user.findUnique
      .mockResolvedValueOnce({ id: 's-9', classRoomId: 'c-9', role: 'student' }) // assertStudentAccess 读
      .mockResolvedValueOnce(null);
    const res = await request(makeApp())
      .get('/api/users/s-9')
      .set('x-test-role', 'teacher')
      .set('x-test-user', 't-1');
    expect(res.status).toBe(403);
  });
});
