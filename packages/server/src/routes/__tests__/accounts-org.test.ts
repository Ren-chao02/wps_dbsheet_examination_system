/**
 * 账号管理组织字段（院系）回归测试（P2 Task 9）。
 * 锁定：POST/PUT /api/accounts 接受 departmentId（uuid 可空）；
 * 非空时写库前先校验院系存在；update 允许传 null 清空、不传则不碰该字段。
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
    user: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    systemRole: { findUnique: vi.fn() },
    department: { findUnique: vi.fn() },
  } as any,
}));
vi.mock('../../config/prisma', () => ({ prisma: mockPrisma }));

import { accountRouter } from '../accounts';

const DEPT_ID = '11111111-1111-4111-8111-111111111111';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/accounts', accountRouter);
  return app;
}

// 无需真实 admin 账号：authenticate 被 mock，authorizePermission 对 admin 角色直接放行
function asAdmin(req: request.Test) {
  return req.set('x-test-role', 'admin');
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.user.findUnique.mockResolvedValue(null); // 用户名查重默认不存在
  mockPrisma.systemRole.findUnique.mockResolvedValue({ id: 'sr-teacher' });
  mockPrisma.department.findUnique.mockResolvedValue(null);
  mockPrisma.user.create.mockResolvedValue({ id: 'u-new' });
  mockPrisma.user.update.mockResolvedValue({ id: 'u-1' });
});

describe('POST /api/accounts 组织字段', () => {
  it('带 departmentId → 先校验院系存在，写入 departmentId 且 select 返回', async () => {
    mockPrisma.department.findUnique.mockResolvedValue({ id: DEPT_ID });

    const res = await asAdmin(
      request(makeApp()).post('/api/accounts'),
    ).send({ username: 't-new', password: 'secret123', departmentId: DEPT_ID });

    expect(res.status).toBe(201);
    expect(mockPrisma.department.findUnique.mock.calls[0][0].where.id).toBe(DEPT_ID);
    const arg = mockPrisma.user.create.mock.calls[0][0];
    expect(arg.data.departmentId).toBe(DEPT_ID);
    expect(arg.select.departmentId).toBe(true);
  });

  it('departmentId 指向不存在的院系 → 400 且不写库', async () => {
    const res = await asAdmin(
      request(makeApp()).post('/api/accounts'),
    ).send({ username: 't-new', password: 'secret123', departmentId: DEPT_ID });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('院系不存在');
    expect(mockPrisma.user.create).not.toHaveBeenCalled();
  });

  it('不传 departmentId → 落库为 null（不依赖数据库默认值）', async () => {
    const res = await asAdmin(
      request(makeApp()).post('/api/accounts'),
    ).send({ username: 't-new', password: 'secret123' });

    expect(res.status).toBe(201);
    expect(mockPrisma.department.findUnique).not.toHaveBeenCalled();
    const arg = mockPrisma.user.create.mock.calls[0][0];
    expect(arg.data.departmentId).toBeNull();
  });
});

describe('PUT /api/accounts/:id 组织字段', () => {
  it('传 null → 清空 departmentId（update data 含 null）', async () => {
    const res = await asAdmin(
      request(makeApp()).put('/api/accounts/u-1'),
    ).send({ departmentId: null });

    expect(res.status).toBe(200);
    // null 表示清空，不需要校验院系存在
    expect(mockPrisma.department.findUnique).not.toHaveBeenCalled();
    const arg = mockPrisma.user.update.mock.calls[0][0];
    expect(arg.data.departmentId).toBeNull();
    expect(arg.select.departmentId).toBe(true);
  });

  it('不传 departmentId → update data 不含该字段（不动现有归属）', async () => {
    const res = await asAdmin(
      request(makeApp()).put('/api/accounts/u-1'),
    ).send({ realName: '张三' });

    expect(res.status).toBe(200);
    const arg = mockPrisma.user.update.mock.calls[0][0];
    expect('departmentId' in arg.data).toBe(false);
  });

  it('传合法 departmentId → 校验院系存在后写入', async () => {
    mockPrisma.department.findUnique.mockResolvedValue({ id: DEPT_ID });

    const res = await asAdmin(
      request(makeApp()).put('/api/accounts/u-1'),
    ).send({ departmentId: DEPT_ID });

    expect(res.status).toBe(200);
    expect(mockPrisma.department.findUnique.mock.calls[0][0].where.id).toBe(DEPT_ID);
    expect(mockPrisma.user.update.mock.calls[0][0].data.departmentId).toBe(DEPT_ID);
  });

  it('传不存在的院系 → 400 且不写库', async () => {
    const res = await asAdmin(
      request(makeApp()).put('/api/accounts/u-1'),
    ).send({ departmentId: DEPT_ID });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('院系不存在');
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });
});
