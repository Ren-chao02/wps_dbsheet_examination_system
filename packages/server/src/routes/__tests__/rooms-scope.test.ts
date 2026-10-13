/**
 * 考场写接口权限回归测试（P1）：新增/编辑/删除/批量导入仅限校级管理员。
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
      req.user = { id: 'u-1', userId: 'u-1', username: 'u-1', role, permissions: [] };
      next();
    },
  };
});

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    examRoom: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(), createMany: vi.fn() },
  } as any,
}));
vi.mock('../../config/prisma', () => ({ prisma: mockPrisma }));

import { roomRouter } from '../rooms';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/rooms', roomRouter);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.examRoom.findUnique.mockResolvedValue(null);
  mockPrisma.examRoom.create.mockResolvedValue({ id: 'r-1', code: 'A101' });
});

describe('教师 → 403 且不触达数据库', () => {
  it('POST /api/rooms', async () => {
    const res = await request(makeApp())
      .post('/api/rooms')
      .set('x-test-role', 'teacher')
      .send({ code: 'A101', name: '机房1', capacity: 50 });
    expect(res.status).toBe(403);
    expect(mockPrisma.examRoom.create).not.toHaveBeenCalled();
  });

  it('POST /api/rooms/bulk-import', async () => {
    const res = await request(makeApp())
      .post('/api/rooms/bulk-import')
      .set('x-test-role', 'teacher')
      .send({ rooms: [{ code: 'A102', name: '机房2', capacity: 50 }] });
    expect(res.status).toBe(403);
    expect(mockPrisma.examRoom.createMany).not.toHaveBeenCalled();
  });

  it('PUT /api/rooms/:id', async () => {
    const res = await request(makeApp())
      .put('/api/rooms/r-1')
      .set('x-test-role', 'teacher')
      .send({ name: '改名' });
    expect(res.status).toBe(403);
    expect(mockPrisma.examRoom.update).not.toHaveBeenCalled();
  });

  it('DELETE /api/rooms/:id', async () => {
    const res = await request(makeApp())
      .delete('/api/rooms/r-1')
      .set('x-test-role', 'teacher');
    expect(res.status).toBe(403);
    expect(mockPrisma.examRoom.delete).not.toHaveBeenCalled();
  });
});

describe('管理员 → 放行', () => {
  it('POST /api/rooms 创建成功', async () => {
    const res = await request(makeApp())
      .post('/api/rooms')
      .set('x-test-role', 'admin')
      .send({ code: 'A101', name: '机房1', capacity: 50 });
    expect(res.status).toBe(201);
    expect(mockPrisma.examRoom.create).toHaveBeenCalledTimes(1);
  });
});
