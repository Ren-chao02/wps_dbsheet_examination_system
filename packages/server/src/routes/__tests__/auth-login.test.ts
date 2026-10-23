/**
 * 账号密码登录：学号/用户名识别、记住我、失败计数、锁定、审计。
 *
 * 通过 vi.mock 替换 prisma / 验证码 / 审计 / WPS SSO，不碰数据库与网络。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';

const { mockPrisma, mockVerifyCaptcha, mockAudit, mockWps, mockGetPermissions } = vi.hoisted(() => ({
  mockPrisma: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
  mockVerifyCaptcha: vi.fn(),
  mockAudit: vi.fn(),
  mockWps: {
    isEnabled: vi.fn(),
    getClientBaseUrl: vi.fn().mockReturnValue(''),
  },
  mockGetPermissions: vi.fn(),
}));

vi.mock('../../config/prisma', () => ({ prisma: mockPrisma }));
vi.mock('../../middleware/auth', () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.user = { id: 'viewer', userId: 'viewer', username: 'viewer', role: 'admin' };
    next();
  },
  authorize: () => (_req: any, _res: any, next: any) => next(),
  getUserPermissions: mockGetPermissions,
}));
vi.mock('../../middleware/audit-middleware', () => ({ manualAuditLog: mockAudit }));
vi.mock('../../utils/captcha', () => ({
  generateMathCaptcha: vi.fn(),
  verifyCaptcha: mockVerifyCaptcha,
}));
vi.mock('../../services/wps-sso-service', () => ({ wpsSsoService: mockWps }));

import { authRouter } from '../auth';
import { config } from '../../config';

const PASSWORD = '123456';
const PASSWORD_HASH = '$2a$10$lhWRrlSD3GjuaNUdNiZyDO6XYpbK3rHDOt2QWTGx8HuF2LRQY2bTa';

const USER = {
  id: 'u-1',
  username: '20252861',
  passwordHash: PASSWORD_HASH,
  realName: '张三',
  role: 'student',
  email: null,
  avatarUrl: null,
  accountStatus: 'ENABLED',
  failedLoginAttempts: 0,
  lockedUntil: null as Date | null,
};

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRouter);
  return app;
}

function loginBody(overrides: Record<string, unknown> = {}) {
  return {
    identifier: USER.username,
    password: PASSWORD,
    captchaToken: 'captcha-id',
    captchaText: '3',
    ...overrides,
  };
}

describe('POST /api/auth/login', () => {
  beforeEach(() => {
    // reset 会清掉 mockResolvedValueOnce 队列，避免上一个用例的返回值串进来
    vi.resetAllMocks();
    mockVerifyCaptcha.mockReturnValue(true);
    mockWps.isEnabled.mockResolvedValue(false);
    mockGetPermissions.mockResolvedValue(['exam']);
    mockPrisma.user.update.mockResolvedValue({});
  });

  it('支持学号登录（username 查不到时回落 studentId）', async () => {
    mockPrisma.user.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(USER);

    const res = await request(makeApp()).post('/api/auth/login').send(loginBody());

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ id: 'u-1', username: '20252861', role: 'student' });
    expect(res.body.permissions).toEqual(['exam']);

    const payload = jwt.verify(res.body.token, config.jwt.secret) as any;
    expect(payload.userId).toBe('u-1');
    expect(payload.permissions).toEqual(['exam']);
  });

  it('兼容旧的 username 字段', async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce(USER);
    const res = await request(makeApp())
      .post('/api/auth/login')
      .send(loginBody({ identifier: undefined, username: USER.username }));
    expect(res.status).toBe(200);
  });

  it('验证码错误直接 400，且不查用户', async () => {
    mockVerifyCaptcha.mockReturnValue(false);
    const res = await request(makeApp()).post('/api/auth/login').send(loginBody());
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('CAPTCHA_INVALID');
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('密码错误返回统一文案并累计失败次数', async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce(USER);
    mockPrisma.user.update.mockResolvedValueOnce({ failedLoginAttempts: 1 });

    const res = await request(makeApp())
      .post('/api/auth/login')
      .send(loginBody({ password: 'wrong-password' }));

    expect(res.status).toBe(401);
    expect(res.body.message).toBe('账号或密码错误');
    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u-1' },
      data: { failedLoginAttempts: { increment: 1 } },
      select: { failedLoginAttempts: true },
    });
  });

  it('第 10 次失败返回 423 与 lockedUntil', async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce(USER);
    mockPrisma.user.update
      .mockResolvedValueOnce({ failedLoginAttempts: 10 })
      .mockResolvedValueOnce({});

    const res = await request(makeApp())
      .post('/api/auth/login')
      .send(loginBody({ password: 'wrong-password' }));

    expect(res.status).toBe(423);
    expect(res.body.code).toBe('ACCOUNT_LOCKED');
    expect(new Date(res.body.lockedUntil).getTime()).toBeGreaterThan(Date.now());
  });

  it('锁定期间即使密码正确也返回 423', async () => {
    const lockedUntil = new Date(Date.now() + 5 * 60 * 1000);
    mockPrisma.user.findUnique.mockResolvedValueOnce({ ...USER, lockedUntil });

    const res = await request(makeApp()).post('/api/auth/login').send(loginBody());

    expect(res.status).toBe(423);
    expect(res.body.lockedUntil).toBe(lockedUntil.toISOString());
  });

  it('密码正确但账号被禁用返回 403', async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce({ ...USER, accountStatus: 'DISABLED' });
    const res = await request(makeApp()).post('/api/auth/login').send(loginBody());
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ACCOUNT_DISABLED');
  });

  it('rememberMe 签发 7 天有效期', async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce(USER);
    const res = await request(makeApp())
      .post('/api/auth/login')
      .send(loginBody({ rememberMe: true }));

    expect(res.status).toBe(200);
    const payload = jwt.verify(res.body.token, config.jwt.secret) as any;
    const ttl = payload.exp - payload.iat;
    const expected = 7 * 24 * 3600;
    expect(Math.abs(ttl - expected)).toBeLessThanOrEqual(1);
  });

  it('审计记录失败原因，不包含密码', async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce(USER);
    mockPrisma.user.update.mockResolvedValueOnce({ failedLoginAttempts: 1 });

    await request(makeApp())
      .post('/api/auth/login')
      .send(loginBody({ password: 'wrong-password' }));

    expect(mockAudit).toHaveBeenCalled();
    const entry = mockAudit.mock.calls[0][0];
    expect(entry.action).toBe('LOGIN');
    expect(entry.newData).toMatchObject({ success: false, method: 'password' });
    expect(JSON.stringify(entry)).not.toContain('wrong-password');
  });
});

describe('GET /api/auth/config', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('返回 WPS SSO 是否可用', async () => {
    mockWps.isEnabled.mockResolvedValue(true);
    const res = await request(makeApp()).get('/api/auth/config');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ wpsSsoEnabled: true });
  });

  it('WPS 服务异常时降级为 false，不影响登录页打开', async () => {
    mockWps.isEnabled.mockRejectedValue(new Error('db down'));
    const res = await request(makeApp()).get('/api/auth/config');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ wpsSsoEnabled: false });
  });
});
