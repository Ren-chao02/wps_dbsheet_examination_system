/**
 * WPS SSO：授权跳转、回调分流（已绑定/未绑定）、绑定页与绑定提交。
 * 全部 mock WPS 服务与数据库，不碰网络。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';

const {
  mockPrisma,
  mockAudit,
  mockWps,
  mockGetPermissions,
  mockVerifyCaptcha,
} = vi.hoisted(() => ({
  mockPrisma: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
  mockAudit: vi.fn(),
  mockWps: {
    isEnabled: vi.fn(),
    getClientBaseUrl: vi.fn(),
    buildAuthorizeUrl: vi.fn(),
    exchangeCode: vi.fn(),
    fetchProfile: vi.fn(),
    signBindTicket: vi.fn(),
    verifyBindTicket: vi.fn(),
  },
  mockGetPermissions: vi.fn(),
  mockVerifyCaptcha: vi.fn(),
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
  lockedUntil: null,
  wpsUserId: null as string | null,
};

const BOUND_USER = { ...USER, id: 'u-2', username: 'teacher1', role: 'teacher', wpsUserId: 'wps-1' };
const PROFILE = { id: 'wps-1', name: '王老师', avatar: '' };

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/auth', authRouter);
  return app;
}

function cookieValue(setCookie: string[] | undefined, name: string): string | undefined {
  const hit = setCookie?.find((item) => item.startsWith(`${name}=`));
  return hit?.split(';')[0].slice(name.length + 1);
}

describe('WPS SSO', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockWps.isEnabled.mockResolvedValue(true);
    mockWps.getClientBaseUrl.mockReturnValue('');
    mockWps.buildAuthorizeUrl.mockResolvedValue('https://openapi.wps.cn/oauth2/auth?mock=1');
    mockWps.exchangeCode.mockResolvedValue('user-access-token');
    mockWps.fetchProfile.mockResolvedValue(PROFILE);
    mockWps.signBindTicket.mockReturnValue('bind-ticket');
    mockGetPermissions.mockResolvedValue(['exam']);
    mockPrisma.user.update.mockResolvedValue({});
  });

  describe('GET /api/auth/wps/authorize', () => {
    it('未启用时 404', async () => {
      mockWps.isEnabled.mockResolvedValue(false);
      const res = await request(makeApp()).get('/api/auth/wps/authorize');
      expect(res.status).toBe(404);
    });

    it('启用时设置 state Cookie 并跳转 WPS', async () => {
      const res = await request(makeApp()).get('/api/auth/wps/authorize');
      expect(res.status).toBe(302);
      expect(res.headers.location).toContain('openapi.wps.cn');
      expect(cookieValue(res.headers['set-cookie'] as any, 'wps_oauth_state')).toBeTruthy();
      expect(mockWps.buildAuthorizeUrl).toHaveBeenCalled();
    });
  });

  describe('GET /api/auth/wps/callback', () => {
    it('state 不匹配时回登录页并给出原因', async () => {
      const res = await request(makeApp())
        .get('/api/auth/wps/callback')
        .query({ code: 'c', state: 'wrong' })
        .set('Cookie', 'wps_oauth_state=expected');
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/login?sso_error=invalid_state');
    });

    it('未绑定：下发 HttpOnly 绑定票据并跳绑定页', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(null);

      const res = await request(makeApp())
        .get('/api/auth/wps/callback')
        .query({ code: 'c', state: 's' })
        .set('Cookie', 'wps_oauth_state=s');

      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/auth/wps/bind');
      const ticket = cookieValue(res.headers['set-cookie'] as any, 'wps_bind_ticket');
      expect(ticket).toBe('bind-ticket');
    });

    it('已绑定：跳前端回调页并在 fragment 带本地 JWT', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(BOUND_USER);

      const res = await request(makeApp())
        .get('/api/auth/wps/callback')
        .query({ code: 'c', state: 's' })
        .set('Cookie', 'wps_oauth_state=s');

      expect(res.status).toBe(302);
      expect(res.headers.location).toMatch(/^\/auth\/wps\/callback#token=/);
      const token = decodeURIComponent(String(res.headers.location).split('#token=')[1]);
      const payload = jwt.verify(token, config.jwt.secret) as any;
      expect(payload.userId).toBe('u-2');
    });

    it('WPS 服务异常时回登录页，不把异常细节暴露到 URL', async () => {
      mockWps.exchangeCode.mockRejectedValue(new Error('invalid code'));
      const res = await request(makeApp())
        .get('/api/auth/wps/callback')
        .query({ code: 'c', state: 's' })
        .set('Cookie', 'wps_oauth_state=s');
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/login?sso_error=wps_error');
    });
  });

  describe('GET /api/auth/wps/pending', () => {
    it('票据有效时返回 WPS 姓名/头像（不返回 WPS ID）', async () => {
      mockWps.verifyBindTicket.mockReturnValue({ ...PROFILE, typ: 'wps_bind' });
      const res = await request(makeApp())
        .get('/api/auth/wps/pending')
        .set('Cookie', 'wps_bind_ticket=bind-ticket');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ name: '王老师', avatar: '' });
      expect(res.body.id).toBeUndefined();
    });

    it('票据无效时 401', async () => {
      mockWps.verifyBindTicket.mockReturnValue(null);
      const res = await request(makeApp())
        .get('/api/auth/wps/pending')
        .set('Cookie', 'wps_bind_ticket=bad');
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('WPS_BIND_EXPIRED');
    });
  });

  describe('POST /api/auth/wps/bind', () => {
    beforeEach(() => {
      mockWps.verifyBindTicket.mockReturnValue({ ...PROFILE, typ: 'wps_bind' });
    });

    it('验证本地密码后写入 wpsUserId 并登录', async () => {
      mockPrisma.user.findUnique
        .mockResolvedValueOnce(USER) // findUserByIdentifier（username 命中）
        .mockResolvedValueOnce(null); // 检查该 WPS 是否已绑定其他账号
      mockPrisma.user.update.mockResolvedValueOnce({ ...USER, wpsUserId: 'wps-1' });

      const res = await request(makeApp())
        .post('/api/auth/wps/bind')
        .set('Cookie', 'wps_bind_ticket=bind-ticket')
        .send({ identifier: USER.username, password: '123456' });

      expect(res.status).toBe(200);
      expect(res.body.token).toBeTruthy();
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u-1' },
        data: { wpsUserId: 'wps-1', wpsBoundAt: expect.any(Date) },
      });
    });

    it('本地密码错误返回 400（避免全局 401 拦截器踢回登录页）', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(USER);
      mockPrisma.user.update.mockResolvedValueOnce({ failedLoginAttempts: 1 });

      const res = await request(makeApp())
        .post('/api/auth/wps/bind')
        .set('Cookie', 'wps_bind_ticket=bind-ticket')
        .send({ identifier: USER.username, password: 'bad-password' });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_CREDENTIALS');
    });

    it('本地账号已绑定其他 WPS 账号时 409', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({ ...USER, wpsUserId: 'other-wps' });
      const res = await request(makeApp())
        .post('/api/auth/wps/bind')
        .set('Cookie', 'wps_bind_ticket=bind-ticket')
        .send({ identifier: USER.username, password: '123456' });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('WPS_ALREADY_BOUND');
    });

    it('该 WPS 已绑定其他本地账号时 409', async () => {
      mockPrisma.user.findUnique
        .mockResolvedValueOnce(USER)
        .mockResolvedValueOnce({ id: 'other-user' });
      const res = await request(makeApp())
        .post('/api/auth/wps/bind')
        .set('Cookie', 'wps_bind_ticket=bind-ticket')
        .send({ identifier: USER.username, password: '123456' });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('WPS_USER_ALREADY_BOUND');
    });

    it('绑定票据过期时 401', async () => {
      mockWps.verifyBindTicket.mockReturnValue(null);
      const res = await request(makeApp())
        .post('/api/auth/wps/bind')
        .set('Cookie', 'wps_bind_ticket=bad')
        .send({ identifier: USER.username, password: '123456' });
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('WPS_BIND_EXPIRED');
    });
  });
});
