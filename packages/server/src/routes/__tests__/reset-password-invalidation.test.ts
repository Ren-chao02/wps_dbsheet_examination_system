/**
 * 管理员/教师重置密码后，旧 token 必须立即失效。
 *
 * 与自助改密保持一致：passwordChangedAt 是 authenticate 判定旧 token 的唯一依据，
 * 重置密码如果不写这个字段，被重置的账号（常因口令泄露而重置）仍能用旧 token 继续访问。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

vi.mock('../../middleware/auth', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    authenticate: (req: any, _res: any, next: any) => {
      req.user = { id: 'admin-1', userId: 'admin-1', username: 'admin', role: 'admin', permissions: [] };
      next();
    },
  };
});

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    user: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
  } as any,
}));
vi.mock('../../config/prisma', () => ({ prisma: mockPrisma }));

// 数据范围校验不是本测试的关注点
vi.mock('../../middleware/exam-ownership', () => ({
  checkStudentAccess: vi.fn(async () => 'ok'),
  denyAccess: vi.fn(),
  assertExamOwnership: vi.fn(async () => true),
}));

import { accountRouter } from '../accounts';
import { studentRouter } from '../students';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/accounts', accountRouter);
  app.use('/api/students', studentRouter);
  return app;
}

describe('重置密码使旧 token 失效', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('管理员重置系统账号密码时写入 passwordChangedAt', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'u-1', username: 'admin2' });
    mockPrisma.user.update.mockResolvedValue({});

    const res = await request(makeApp()).put('/api/accounts/reset-password/u-1').send({});

    expect(res.status).toBe(200);
    const updateArg = mockPrisma.user.update.mock.calls[0][0];
    expect(updateArg.data.passwordChangedAt).toBeInstanceOf(Date);
  });

  it('教师/管理员重置学生密码时写入 passwordChangedAt', async () => {
    mockPrisma.user.findFirst.mockResolvedValue({ id: 's-1', studentId: '20260001' });
    mockPrisma.user.update.mockResolvedValue({});

    const res = await request(makeApp()).put('/api/students/s-1/reset-password').send({});

    expect(res.status).toBe(200);
    const updateArg = mockPrisma.user.update.mock.calls[0][0];
    expect(updateArg.data.passwordChangedAt).toBeInstanceOf(Date);
  });
});
