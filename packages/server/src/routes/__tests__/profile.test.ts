/**
 * 个人信息 / 修改密码接口测试
 *
 * 覆盖：
 * - GET /api/profile/me：返回当前用户身份卡字段（关联名称），绝不返回 passwordHash
 * - GET /api/profile/me：用户被删后返回 404
 * - POST /api/profile/change-password：
 *   · 新密码不足 8 位 → 400（不查库）
 *   · 旧密码错误 → 400 且不写库
 *   · 新旧密码相同 → 400 且不写库
 *   · 成功 → 写入可被新密码验证的哈希，并记录 passwordChangedAt
 *
 * 通过 vi.mock 替换 authenticate（免 JWT 与 DB 角色查询）、config/prisma（免 DB）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

vi.mock('../../middleware/auth', () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.user = { id: 'u1', userId: 'u1', username: 'T2026001', role: 'teacher' };
    next();
  },
  authorize: () => (_req: any, _res: any, next: any) => next(),
}));

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    user: { findUnique: vi.fn(), update: vi.fn() },
  } as any,
}));

vi.mock('../../config/prisma', () => ({ prisma: mockPrisma }));

import { profileRouter } from '../profile';
import { hashPassword, verifyPassword } from '../../services/password-hash';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/profile', profileRouter);
  return app;
}

const USER_ROW = {
  id: 'u1',
  username: 'T2026001',
  realName: '王老师',
  role: 'teacher',
  avatarUrl: null,
  email: 'wang@example.com',
  phoneNumber: '13800000000',
  gender: null,
  studentId: null,
  employeeId: 'T2026001',
  accountStatus: 'ENABLED',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  lastLoginAt: new Date('2026-10-25T08:00:00Z'),
  wpsBoundAt: null,
  systemRole: { roleCode: 'TEACHER', roleName: '教师' },
  department: { name: '计算机学院' },
  major: null,
  classRoom: null,
};

describe('GET /api/profile/me', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('返回身份卡字段（关联名称拍平）且不泄露 passwordHash', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(USER_ROW);
    const res = await request(makeApp()).get('/api/profile/me');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      username: 'T2026001',
      employeeId: 'T2026001',
      department: '计算机学院',
      role: 'teacher',
      systemRole: { roleCode: 'TEACHER', roleName: '教师' },
    });
    expect(res.body.passwordHash).toBeUndefined();
  });

  it('用户不存在时返回 404', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    const res = await request(makeApp()).get('/api/profile/me');

    expect(res.status).toBe(404);
  });
});

describe('POST /api/profile/change-password', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('新密码不足 8 位时返回 400，且不查库', async () => {
    const res = await request(makeApp())
      .post('/api/profile/change-password')
      .send({ oldPassword: 'old-pass-123', newPassword: 'short' });

    expect(res.status).toBe(400);
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('旧密码错误时返回 400，且不写库', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      passwordHash: await hashPassword('old-pass-123'),
    });

    const res = await request(makeApp())
      .post('/api/profile/change-password')
      .send({ oldPassword: 'wrong-pass', newPassword: 'new-pass-456' });

    expect(res.status).toBe(400);
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it('新旧密码相同时返回 400，且不写库', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      passwordHash: await hashPassword('same-pass-123'),
    });

    const res = await request(makeApp())
      .post('/api/profile/change-password')
      .send({ oldPassword: 'same-pass-123', newPassword: 'same-pass-123' });

    expect(res.status).toBe(400);
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it('修改成功时写入新密码哈希并记录 passwordChangedAt', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      passwordHash: await hashPassword('old-pass-123'),
    });
    mockPrisma.user.update.mockResolvedValue({});

    const res = await request(makeApp())
      .post('/api/profile/change-password')
      .send({ oldPassword: 'old-pass-123', newPassword: 'new-pass-456' });

    expect(res.status).toBe(200);
    expect(mockPrisma.user.update).toHaveBeenCalledTimes(1);

    const updateArg = mockPrisma.user.update.mock.calls[0][0];
    expect(updateArg.where).toEqual({ id: 'u1' });
    expect(updateArg.data.passwordChangedAt).toBeInstanceOf(Date);
    await expect(verifyPassword('new-pass-456', updateArg.data.passwordHash)).resolves.toBe(true);
  });
});
