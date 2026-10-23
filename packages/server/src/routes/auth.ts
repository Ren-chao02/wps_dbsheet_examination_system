import crypto from 'crypto';
import { Router, Request, Response } from 'express';

import jwt from 'jsonwebtoken';
import { z } from 'zod';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { AuditAction } from '@prisma/client';
import { prisma } from '../config/prisma';
import { config } from '../config';
import { isLoopback } from '../utils/ip-utils';
import { createLoginFailureLimiter } from '../middleware/login-failure-limiter';
import { authenticate, JwtPayload, getUserPermissions } from '../middleware/auth';
import { manualAuditLog } from '../middleware/audit-middleware';
import { generateMathCaptcha, verifyCaptcha } from '../utils/captcha';
import {
  findUserByIdentifier,
  getActiveLock,
  markLoginSuccess,
  recordFailedLogin,
  signAuthToken,
} from '../services/login-security';
import { wpsSsoService } from '../services/wps-sso-service';
import { logger } from '../utils/logger';
import { hashPassword, verifyPassword } from '../services/password-hash';

export const authRouter = Router();

/**
 * 与原实现等价的假哈希：账号不存在时也做一次 bcrypt 比较，
 * 让「用户不存在」和「密码错误」的响应时间接近，降低账号枚举价值。
 */
const DUMMY_PASSWORD_HASH = '$2a$10$4oi/Av3Q0jqMjYmKn1BlhOF8kY6taRmK6QgkXUmBW48L2abKodEYW';

const identifierSchema = z.string().min(2).max(64);

const loginSchema = z
  .object({
    identifier: identifierSchema.optional(),
    // 兼容旧调用方（仍可只传 username）
    username: identifierSchema.optional(),
    password: z.string().min(6),
    captchaToken: z.string().min(1, '请输入验证码'),
    captchaText: z.string().min(1, '请输入验证码'),
    rememberMe: z.boolean().optional().default(false),
  })
  .refine((v) => Boolean(v.identifier || v.username), {
    message: '请输入学号、工号或系统账号',
    path: ['identifier'],
  });

const bindSchema = z.object({
  identifier: identifierSchema,
  password: z.string().min(6),
});

// ============================================================
// 限流
// ============================================================

/**
 * 登录失败限流：只对失败请求计数（skipSuccessfulRequests），
 * 阈值故意放宽到 100 次 / 15 分钟 —— 机房整班共用一个出口 IP，
 * 按账号锁定已经能挡住暴力破解，IP 限流只兜底异常流量。
 */
export function createLoginLimiter(
  limit = config.login.ipLimit,
  windowMs = config.login.ipWindowMinutes * 60 * 1000,
) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    keyGenerator: (req: Request) => ipKeyGenerator(req.ip || 'unknown'),
    message: { message: '登录尝试过于频繁，请稍后再试', code: 'TOO_MANY_ATTEMPTS' },
  });
}

// 登录用「失败才计数」的限流器：成功请求不占额度，整班 NAT 并发不会误伤
const loginLimiter = createLoginFailureLimiter();
const bindLimiter = createLoginLimiter();
const captchaLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  // 机房整班共用出口 IP：300 次/15 分钟在 100+ 人同时登录时可能不够，放到 1000
  limit: 1000,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req: Request) => ipKeyGenerator(req.ip || 'unknown'),
  message: { message: '验证码请求过于频繁，请稍后再试' },
});

// ============================================================
// 工具
// ============================================================

interface PublicUser {
  id: string;
  username: string;
  realName: string | null;
  role: string;
  email: string | null;
  avatarUrl: string | null;
  accountStatus: string;
}

function toPublicUser(user: {
  id: string;
  username: string;
  realName: string | null;
  role: string;
  email: string | null;
  avatarUrl: string | null;
  accountStatus: string;
}): PublicUser {
  return {
    id: user.id,
    username: user.username,
    realName: user.realName,
    role: user.role,
    email: user.email,
    avatarUrl: user.avatarUrl,
    accountStatus: user.accountStatus,
  };
}

function sendLocked(res: Response, lockedUntil: Date) {
  return res.status(423).json({
    code: 'ACCOUNT_LOCKED',
    message: '登录失败次数过多，账号已锁定，请稍后重试',
    lockedUntil: lockedUntil.toISOString(),
  });
}

type LoginMethod = 'password' | 'wps' | 'wps_bind';

function auditLogin(
  req: Request,
  params: {
    success: boolean;
    reason: string;
    method: LoginMethod;
    userId?: string;
    username?: string;
    userRole?: string;
  },
) {
  // 审计写入不阻塞响应；manualAuditLog 内部已做失败兜底
  void manualAuditLog({
    action: AuditAction.LOGIN,
    entityType: 'Auth',
    entityId: params.userId,
    userId: params.userId,
    username: params.username,
    userRole: params.userRole,
    newData: {
      success: params.success,
      reason: params.reason,
      method: params.method,
    },
    ipAddress: req.ip,
    userAgent:
      typeof req.headers['user-agent'] === 'string'
        ? req.headers['user-agent'].slice(0, 1000)
        : undefined,
    requestUrl: `${req.method} ${req.originalUrl}`.slice(0, 512),
  });
}

function redirectToLogin(res: Response, reason: string) {
  const base = wpsSsoService.getClientBaseUrl();
  res.redirect(`${base}/login?sso_error=${encodeURIComponent(reason)}`);
}

function redirectToClient(res: Response, pathAndHash: string) {
  const base = wpsSsoService.getClientBaseUrl();
  res.redirect(`${base}${pathAndHash}`);
}

const cookieBase = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: config.nodeEnv === 'production',
  path: '/api/auth/wps',
};

// ============================================================
// 验证码 / 登录页配置
// ============================================================

// GET /api/auth/captcha
authRouter.get('/captcha', captchaLimiter, (req: Request, res: Response) => {
  try {
    // 生产环境默认不返回答案；本地 E2E 用 E2E_CAPTCHA_DEBUG=true 且仅回环地址放行。
    // 必须用 socket 层地址：req.ip 受 trust proxy / X-Forwarded-For 影响，
    // 客户端自带一个 127.0.0.1 转发头就能在公网拿到 debugAnswer（验证码形同虚设）。
    const includeDebug =
      config.nodeEnv !== 'production' ||
      (process.env.E2E_CAPTCHA_DEBUG === 'true' && isLoopback(req.socket.remoteAddress));
    const { svg, captchaToken, debugAnswer } = generateMathCaptcha(includeDebug);
    res.json({
      svg,
      captchaToken,
      // 仅非生产环境返回：供 Playwright 解算；生产环境答案只在服务端
      ...(debugAnswer ? { debugAnswer } : {}),
    });
  } catch {
    res.status(500).json({ message: '验证码生成失败' });
  }
});

// GET /api/auth/config —— 登录页据此决定是否显示 WPS 登录入口
authRouter.get('/config', async (_req: Request, res: Response) => {
  try {
    res.json({ wpsSsoEnabled: await wpsSsoService.isEnabled() });
  } catch {
    res.json({ wpsSsoEnabled: false });
  }
});

// ============================================================
// 账号密码登录
// ============================================================

// POST /api/auth/login
authRouter.post('/login', loginLimiter, async (req: Request, res: Response) => {
  try {
    const data = loginSchema.parse(req.body);
    const identifier = data.identifier || data.username!;

    // 验证码先校验：验证码错误不消耗账号失败次数
    if (!verifyCaptcha(data.captchaText, data.captchaToken)) {
      auditLogin(req, {
        success: false,
        reason: 'CAPTCHA_INVALID',
        method: 'password',
        username: identifier,
      });
      return res.status(400).json({
        code: 'CAPTCHA_INVALID',
        message: '验证码错误或已过期，请刷新后重试',
      });
    }

    const user = await findUserByIdentifier(identifier);

    // 账号不存在也跑一次 bcrypt，避免用响应时间判断账号是否存在
    const passwordValid = await verifyPassword(
      data.password,
      user?.passwordHash || DUMMY_PASSWORD_HASH,
    );

    if (!user || !passwordValid) {
      if (user) {
        const lock = await getActiveLock(user);
        if (lock) {
          auditLogin(req, {
            success: false,
            reason: 'ACCOUNT_LOCKED',
            method: 'password',
            userId: user.id,
            username: user.username,
            userRole: user.role,
          });
          return sendLocked(res, lock);
        }

        const failed = await recordFailedLogin(user.id);
        auditLogin(req, {
          success: false,
          reason: failed.lockedUntil ? 'ACCOUNT_LOCKED' : 'INVALID_CREDENTIALS',
          method: 'password',
          userId: user.id,
          username: user.username,
          userRole: user.role,
        });
        if (failed.lockedUntil) return sendLocked(res, failed.lockedUntil);
      } else {
        auditLogin(req, {
          success: false,
          reason: 'INVALID_CREDENTIALS',
          method: 'password',
          username: identifier,
        });
      }

      return res.status(401).json({ message: '账号或密码错误' });
    }

    // 密码正确后才检查锁定/禁用：避免在不知道密码的情况下也能探测账号状态
    const lock = await getActiveLock(user);
    if (lock) {
      auditLogin(req, {
        success: false,
        reason: 'ACCOUNT_LOCKED',
        method: 'password',
        userId: user.id,
        username: user.username,
        userRole: user.role,
      });
      return sendLocked(res, lock);
    }

    if (user.accountStatus === 'DISABLED') {
      auditLogin(req, {
        success: false,
        reason: 'ACCOUNT_DISABLED',
        method: 'password',
        userId: user.id,
        username: user.username,
        userRole: user.role,
      });
      return res.status(403).json({
        message: '账号已被禁用，请联系管理员',
        code: 'ACCOUNT_DISABLED',
      });
    }

    const permissions = await getUserPermissions(user.id);
    const { token, expiresIn } = signAuthToken(user, permissions, data.rememberMe);
    await markLoginSuccess(user.id);

    auditLogin(req, {
      success: true,
      reason: 'SUCCESS',
      method: 'password',
      userId: user.id,
      username: user.username,
      userRole: user.role,
    });

    res.json({
      token,
      expiresIn,
      user: toPublicUser(user),
      permissions,
    });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: '参数错误', errors: err.errors });
    }
    logger.error({ err }, '[auth/login] 服务器错误');
    res.status(500).json({ message: '服务器错误' });
  }
});

// ============================================================
// WPS 账号 SSO
// ============================================================

// GET /api/auth/wps/authorize
authRouter.get('/wps/authorize', async (req: Request, res: Response) => {
  try {
    if (!(await wpsSsoService.isEnabled())) {
      return res.status(404).json({ message: 'WPS 登录未启用' });
    }

    const state = crypto.randomBytes(32).toString('hex');
    res.cookie('wps_oauth_state', state, { ...cookieBase, maxAge: 10 * 60 * 1000 });
    const url = await wpsSsoService.buildAuthorizeUrl(state);
    res.redirect(url);
  } catch (err: any) {
    logger.warn({ err }, '[auth/wps/authorize] 构造授权地址失败');
    redirectToLogin(res, 'wps_unavailable');
  }
});

// GET /api/auth/wps/callback
authRouter.get('/wps/callback', async (req: Request, res: Response) => {
  try {
    if (!(await wpsSsoService.isEnabled())) {
      return res.status(404).json({ message: 'WPS 登录未启用' });
    }

    const { code, state, error, error_description } = req.query as Record<string, string | undefined>;

    if (error) {
      logger.warn({ error, error_description }, '[auth/wps/callback] WPS 返回授权错误');
      return redirectToLogin(res, error === 'access_denied' ? 'wps_cancelled' : 'wps_error');
    }

    const expectedState = req.cookies?.wps_oauth_state;
    res.clearCookie('wps_oauth_state', cookieBase);
    if (!code || !state || !expectedState || !safeEqual(state, expectedState)) {
      return redirectToLogin(res, 'invalid_state');
    }

    const accessToken = await wpsSsoService.exchangeCode(code);
    const profile = await wpsSsoService.fetchProfile(accessToken);

    const boundUser = await prisma.user.findUnique({ where: { wpsUserId: profile.id } });

    if (boundUser) {
      if (boundUser.accountStatus === 'DISABLED') {
        auditLogin(req, {
          success: false,
          reason: 'ACCOUNT_DISABLED',
          method: 'wps',
          userId: boundUser.id,
          username: boundUser.username,
          userRole: boundUser.role,
        });
        return redirectToLogin(res, 'account_disabled');
      }

      const permissions = await getUserPermissions(boundUser.id);
      const { token } = signAuthToken(boundUser, permissions, false);
      await markLoginSuccess(boundUser.id);
      auditLogin(req, {
        success: true,
        reason: 'SUCCESS',
        method: 'wps',
        userId: boundUser.id,
        username: boundUser.username,
        userRole: boundUser.role,
      });
      return redirectToClient(res, `/auth/wps/callback#token=${encodeURIComponent(token)}`);
    }

    // 未绑定：把 WPS 身份放进 10 分钟有效的 HttpOnly 票据，前端只拿得到姓名/头像
    const ticket = wpsSsoService.signBindTicket(profile);
    res.cookie('wps_bind_ticket', ticket, { ...cookieBase, maxAge: 10 * 60 * 1000 });
    redirectToClient(res, '/auth/wps/bind');
  } catch (err: any) {
    logger.warn({ err }, '[auth/wps/callback] WPS 登录失败');
    auditLogin(req, { success: false, reason: 'WPS_ERROR', method: 'wps' });
    redirectToLogin(res, 'wps_error');
  }
});

// GET /api/auth/wps/pending —— 绑定页展示 WPS 身份
authRouter.get('/wps/pending', (req: Request, res: Response) => {
  const ticket = req.cookies?.wps_bind_ticket;
  const payload = ticket ? wpsSsoService.verifyBindTicket(ticket) : null;
  if (!payload) {
    return res.status(401).json({
      code: 'WPS_BIND_EXPIRED',
      message: '绑定会话已过期，请重新使用 WPS 登录',
    });
  }
  res.json({ name: payload.name, avatar: payload.avatar });
});

// POST /api/auth/wps/bind —— 首次 SSO：验证本地密码后建立绑定
authRouter.post('/wps/bind', bindLimiter, async (req: Request, res: Response) => {
  try {
    const data = bindSchema.parse(req.body);
    const ticket = req.cookies?.wps_bind_ticket;
    const payload = ticket ? wpsSsoService.verifyBindTicket(ticket) : null;

    if (!payload) {
      return res.status(401).json({
        code: 'WPS_BIND_EXPIRED',
        message: '绑定会话已过期，请重新使用 WPS 登录',
      });
    }

    const user = await findUserByIdentifier(data.identifier);
    const passwordValid = await verifyPassword(
      data.password,
      user?.passwordHash || DUMMY_PASSWORD_HASH,
    );

    if (!user || !passwordValid) {
      if (user) {
        const lock = await getActiveLock(user);
        if (lock) return sendLocked(res, lock);
        const failed = await recordFailedLogin(user.id);
        auditLogin(req, {
          success: false,
          reason: failed.lockedUntil ? 'ACCOUNT_LOCKED' : 'INVALID_CREDENTIALS',
          method: 'wps_bind',
          userId: user.id,
          username: user.username,
          userRole: user.role,
        });
        if (failed.lockedUntil) return sendLocked(res, failed.lockedUntil);
      } else {
        auditLogin(req, {
          success: false,
          reason: 'INVALID_CREDENTIALS',
          method: 'wps_bind',
          username: data.identifier,
        });
      }
      // 绑定页用 400 而不是 401：避免前端全局 401 拦截器把用户整页踢回登录页
      return res.status(400).json({ code: 'INVALID_CREDENTIALS', message: '账号或密码错误' });
    }

    const lock = await getActiveLock(user);
    if (lock) return sendLocked(res, lock);

    if (user.accountStatus === 'DISABLED') {
      return res.status(403).json({
        message: '账号已被禁用，请联系管理员',
        code: 'ACCOUNT_DISABLED',
      });
    }

    if (user.wpsUserId && user.wpsUserId !== payload.id) {
      return res.status(409).json({
        code: 'WPS_ALREADY_BOUND',
        message: '该账号已绑定其他 WPS 账号，请联系管理员解绑',
      });
    }

    const other = await prisma.user.findUnique({ where: { wpsUserId: payload.id } });
    if (other && other.id !== user.id) {
      return res.status(409).json({
        code: 'WPS_USER_ALREADY_BOUND',
        message: '该 WPS 账号已绑定其他账号，请联系管理员',
      });
    }

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { wpsUserId: payload.id, wpsBoundAt: new Date() },
    });

    const permissions = await getUserPermissions(updated.id);
    const { token, expiresIn } = signAuthToken(updated, permissions, false);
    await markLoginSuccess(updated.id);
    res.clearCookie('wps_bind_ticket', cookieBase);

    auditLogin(req, {
      success: true,
      reason: 'WPS_BOUND',
      method: 'wps_bind',
      userId: updated.id,
      username: updated.username,
      userRole: updated.role,
    });

    res.json({
      token,
      expiresIn,
      user: toPublicUser(updated),
      permissions,
    });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: '参数错误', errors: err.errors });
    }
    if (err?.code === 'P2002') {
      return res.status(409).json({
        code: 'WPS_USER_ALREADY_BOUND',
        message: '该 WPS 账号已绑定其他账号，请联系管理员',
      });
    }
    logger.error({ err }, '[auth/wps/bind] 绑定失败');
    res.status(500).json({ message: '服务器错误' });
  }
});

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

/**
 * POST /api/auth/register —— 已关闭的自助注册入口
 *
 * 关闭原因：原实现允许请求体自带 `role: 'teacher'`，且无验证码/邀请码/限流，
 * 任何匿名访客一次请求即可获得教师权限（可看全校学生隐私、改他人试卷、导出成绩）。
 *
 * 现在的入班方式：
 * - 学生：走班级邀请链接（GET /api/invitations/:code/info + POST /api/invitations/:code/apply，
 *   由教师审批后建号），该链路不经过本接口；
 * - 教师/管理员：由管理员在「账户管理」或批量导入中创建。
 *
 * 保留路由（而不是删除）是为了给老客户端/书签一个明确可读的失败原因。
 */
authRouter.post('/register', (_req: Request, res: Response) => {
  res.status(403).json({
    message: '系统已关闭自助注册，请通过教师提供的班级邀请链接加入；教师账号请联系管理员开通',
    code: 'REGISTRATION_DISABLED',
  });
});

// GET /api/auth/me
authRouter.get('/me', authenticate, async (req: Request, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: {
        id: true,
        username: true,
        realName: true,
        role: true,
        email: true,
        avatarUrl: true,
        systemRoleId: true,
        systemRole: {
          select: {
            roleCode: true,
            roleName: true,
            permissions: { select: { moduleCode: true } },
          },
        },
        createdAt: true,
      },
    });

    if (!user) {
      return res.status(404).json({ message: '用户不存在' });
    }

    const permissions = user.systemRole?.permissions.map((p) => p.moduleCode) || [];
    // admin 角色返回全部权限
    if (user.role === 'admin') {
      const { SYSTEM_MODULES } = await import('../constants/modules');
      const allPerms = SYSTEM_MODULES.map((m) => m.code);
      return res.json({ ...user, permissions: allPerms });
    }

    res.json({ ...user, permissions });
  } catch {
    res.status(500).json({ message: '服务器错误' });
  }
});

// POST /api/auth/refresh
authRouter.post('/refresh', authenticate, async (req: Request, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
    if (!user) {
      return res.status(404).json({ message: '用户不存在' });
    }

    const permissions = await getUserPermissions(user.id);

    const payload: JwtPayload = {
      id: user.id,
      userId: user.id,
      username: user.username,
      role: user.role,
      permissions,
    };

    const token = jwt.sign(payload, config.jwt.secret, {
      expiresIn: config.jwt.expiresIn as any,
    });

    res.json({ token, permissions });
  } catch {
    res.status(500).json({ message: '服务器错误' });
  }
});
