/**
 * 邀请与申请的数据范围回归测试（P1）：
 * - 教师只能为自己任教的班级创建邀请
 * - 教师只能看到自己任教班级的入学申请
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
    teacherClass: { findMany: vi.fn(), findFirst: vi.fn() },
    classRoom: { findUnique: vi.fn() },
    invitation: { create: vi.fn(), updateMany: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    studentApplication: { findMany: vi.fn(), count: vi.fn() },
  } as any,
}));
vi.mock('../../config/prisma', () => ({ prisma: mockPrisma }));

import { invitationRouter, applicationRouter } from '../invitations';

// zod 的 uuid 校验要求请求体里是合法 UUID —— 测试数据与 mock 返回值共用这组常量
const C1 = '00000000-0000-4000-8000-000000000001';
const C9 = '00000000-0000-4000-8000-000000000009';

function makeApp(router: express.Router, base: string) {
  const app = express();
  app.use(express.json());
  app.use(base, router);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.teacherClass.findMany.mockResolvedValue([{ classId: C1 }]);
  mockPrisma.classRoom.findUnique.mockResolvedValue({ id: C9, department: {}, major: {} });
  mockPrisma.studentApplication.findMany.mockResolvedValue([]);
  mockPrisma.studentApplication.count.mockResolvedValue(0);
});

describe('POST /api/invitations 创建邀请', () => {
  it('教师为他人班级创建 → 403', async () => {
    const res = await request(makeApp(invitationRouter, '/api/invitations'))
      .post('/api/invitations')
      .set('x-test-role', 'teacher')
      .set('x-test-user', 't-1')
      .send({ classRoomId: C9, expiresAt: new Date(Date.now() + 86400000).toISOString(), maxUses: 100 });
    expect(res.status).toBe(403);
    expect(mockPrisma.invitation.create).not.toHaveBeenCalled();
  });
});

describe('GET /api/applications 申请列表', () => {
  it('教师 → where 限定任教班级的申请', async () => {
    const res = await request(makeApp(applicationRouter, '/api/applications'))
      .get('/api/applications')
      .set('x-test-role', 'teacher')
      .set('x-test-user', 't-1');
    expect(res.status).toBe(200);
    const where = mockPrisma.studentApplication.findMany.mock.calls[0][0].where;
    expect(where.AND[0]).toEqual({ invitation: { classRoomId: { in: [C1] } } });
  });

  it('admin → 无范围条件', async () => {
    const res = await request(makeApp(applicationRouter, '/api/applications'))
      .get('/api/applications')
      .set('x-test-role', 'admin');
    expect(res.status).toBe(200);
    const where = mockPrisma.studentApplication.findMany.mock.calls[0][0].where;
    expect(where.AND[0]).toEqual({});
  });
});
