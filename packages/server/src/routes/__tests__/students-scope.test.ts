/**
 * 学生名册/创建/导入的数据范围回归测试（P1）。
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
    user: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn(), create: vi.fn(), update: vi.fn() },
    classRoom: { findUnique: vi.fn() },
  } as any,
}));
vi.mock('../../config/prisma', () => ({ prisma: mockPrisma }));

import { studentRouter } from '../students';

// zod 的 uuid 校验要求请求体里是合法 UUID —— 测试数据与 mock 返回值共用这组常量
const C1 = '00000000-0000-4000-8000-000000000001';
const C9 = '00000000-0000-4000-8000-000000000009';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/students', studentRouter);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.teacherClass.findMany.mockResolvedValue([{ classId: C1 }]);
  mockPrisma.user.findMany.mockResolvedValue([]);
  mockPrisma.user.count.mockResolvedValue(0);
  mockPrisma.user.findUnique.mockResolvedValue(null);
});

describe('GET /api/students 列表', () => {
  it('教师 → where 限定任教班级（含未分班收紧）', async () => {
    const res = await request(makeApp())
      .get('/api/students')
      .set('x-test-role', 'teacher')
      .set('x-test-user', 't-1');
    expect(res.status).toBe(200);
    const where = mockPrisma.user.findMany.mock.calls[0][0].where;
    expect(where.AND[0]).toEqual({ role: 'student', classRoomId: { in: [C1] } });
  });
});

describe('POST /api/students 创建', () => {
  it('教师往他人班级建学生 → 403', async () => {
    mockPrisma.classRoom.findUnique.mockResolvedValue({ id: C9, departmentId: 'd-1', majorId: 'm-1' });
    const res = await request(makeApp())
      .post('/api/students')
      .set('x-test-role', 'teacher')
      .set('x-test-user', 't-1')
      .send({ username: 'stu1', realName: '张三', studentId: '2026001', classRoomId: C9 });
    expect(res.status).toBe(403);
    expect(mockPrisma.user.create).not.toHaveBeenCalled();
  });

  it('教师往未分班（无班级）建学生 → 403', async () => {
    const res = await request(makeApp())
      .post('/api/students')
      .set('x-test-role', 'teacher')
      .set('x-test-user', 't-1')
      .send({ username: 'stu1', realName: '张三', studentId: '2026001' });
    expect(res.status).toBe(403);
    expect(mockPrisma.user.create).not.toHaveBeenCalled();
  });

  it('教师往本班建学生 → 201', async () => {
    mockPrisma.classRoom.findUnique.mockResolvedValue({ id: C1, departmentId: 'd-1', majorId: 'm-1' });
    mockPrisma.user.create.mockResolvedValue({ id: 's-new', username: 'stu1', realName: '张三', studentId: '2026001', classRoomId: C1, role: 'student' });
    const res = await request(makeApp())
      .post('/api/students')
      .set('x-test-role', 'teacher')
      .set('x-test-user', 't-1')
      .send({ username: 'stu1', realName: '张三', studentId: '2026001', classRoomId: C1 });
    expect(res.status).toBe(201);
    expect(mockPrisma.user.create).toHaveBeenCalledTimes(1);
  });
});
