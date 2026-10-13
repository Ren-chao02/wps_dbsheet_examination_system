/**
 * 通知发送的数据范围回归测试（P1）：
 * - 教师向非任教班级群发 → 403
 * - 教师向范围外 userIds 发送 → 403
 * - 模板增删改 → 仅校级管理员
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

vi.mock('../../services/notification-service', () => ({
  notificationService: { sendToUsers: vi.fn().mockResolvedValue({ success: true, count: 1 }) },
}));

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    teacherClass: { findMany: vi.fn() },
    user: { findMany: vi.fn() },
    notificationTemplate: { create: vi.fn(), update: vi.fn(), delete: vi.fn(), count: vi.fn(), findMany: vi.fn() },
  } as any,
}));
vi.mock('../../config/prisma', () => ({ prisma: mockPrisma }));

import { notificationRouter } from '../notifications';
// notifications 路由自身没有 router.use(authenticate)，生产是 app.ts 挂载时拼在 router 前面
// （见 src/app.ts `app.use('/api/notifications', authenticate, notificationRouter)`）——
// 测试若只挂 router，req.user 永远为空、所有用例都会在 authorize 处 401，故这里照抄同款挂法。
import { authenticate } from '../../middleware/auth';

// zod 校验：班级/用户 ID 必须是合法 UUID，且 type 必填 —— 测试数据与 mock 返回值共用常量
const C1 = '00000000-0000-4000-8000-000000000001';
const C9 = '00000000-0000-4000-8000-000000000009';
const S1 = '00000000-0000-4000-8000-000000000011';
const S9 = '00000000-0000-4000-8000-000000000019';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/notifications', authenticate, notificationRouter);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.teacherClass.findMany.mockResolvedValue([{ classId: C1 }]);
  mockPrisma.user.findMany.mockResolvedValue([{ id: S1 }]);
});

describe('POST /api/notifications/send', () => {
  it('教师向非任教班级群发 → 403', async () => {
    const res = await request(makeApp())
      .post('/api/notifications/send')
      .set('x-test-role', 'teacher')
      .set('x-test-user', 't-1')
      .send({ type: 'EXAM', title: '通知', content: '内容', classRoomIds: [C9] });
    expect(res.status).toBe(403);
  });

  it('教师向本班群发 → 200', async () => {
    const res = await request(makeApp())
      .post('/api/notifications/send')
      .set('x-test-role', 'teacher')
      .set('x-test-user', 't-1')
      .send({ type: 'EXAM', title: '通知', content: '内容', classRoomIds: [C1] });
    expect(res.status).toBe(200);
  });

  it('教师带范围外 userIds → 403', async () => {
    // 校验查询只返回 S1，但请求里塞了 S9
    const res = await request(makeApp())
      .post('/api/notifications/send')
      .set('x-test-role', 'teacher')
      .set('x-test-user', 't-1')
      .send({ type: 'EXAM', title: '通知', content: '内容', userIds: [S1, S9] });
    expect(res.status).toBe(403);
  });
});

describe('模板增删改', () => {
  it('教师创建模板 → 403', async () => {
    const res = await request(makeApp())
      .post('/api/notifications/templates')
      .set('x-test-role', 'teacher')
      .send({ name: 't', type: 'EXAM', title: '标题', content: '内容' });
    expect(res.status).toBe(403);
    expect(mockPrisma.notificationTemplate.create).not.toHaveBeenCalled();
  });
});
