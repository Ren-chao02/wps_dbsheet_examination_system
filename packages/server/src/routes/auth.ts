import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { prisma } from '../config/prisma';
import { config } from '../config';
import { authenticate, JwtPayload, getUserPermissions } from '../middleware/auth';
import { generateMathCaptcha, verifyCaptcha } from '../utils/captcha';

export const authRouter = Router();

const loginSchema = z.object({
  username: z.string().min(2).max(64),
  password: z.string().min(6),
  captchaToken: z.string().min(1, '请输入验证码'),
  captchaText: z.string().min(1, '请输入验证码'),
});

const registerSchema = z.object({
  username: z.string().min(2).max(64),
  password: z.string().min(6),
  realName: z.string().optional(),
  email: z.string().email().optional(),
  role: z.enum(['teacher', 'student']).default('student'),
});

// GET /api/auth/captcha - 获取验证码
authRouter.get('/captcha', (_req: Request, res: Response) => {
  try {
    const { svg, token } = generateMathCaptcha();
    res.json({ svg, captchaToken: token });
  } catch {
    res.status(500).json({ message: '验证码生成失败' });
  }
});

// POST /api/auth/login
authRouter.post('/login', async (req: Request, res: Response) => {
  try {
    const { username, password, captchaToken, captchaText } = loginSchema.parse(req.body);

    // 验证码校验
    if (!verifyCaptcha(captchaText, captchaToken)) {
      return res.status(400).json({ message: '验证码错误或已过期，请刷新后重试' });
    }

    const user = await prisma.user.findUnique({ where: { username } });
    if (!user) {
      return res.status(401).json({ message: '用户名或密码错误' });
    }

    // ✅ 新增：检查账号状态
    if (user.accountStatus === 'DISABLED') {
      return res.status(403).json({
        message: '账号已被禁用，请联系管理员',
        code: 'ACCOUNT_DISABLED',
      });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ message: '用户名或密码错误' });
    }

    const permissions = await getUserPermissions(user.id);

    const payload: JwtPayload = {
      id: user.id,
      userId: user.id,
      username: user.username,
      role: user.role,
      realName: user.realName || undefined,  // ✅ 新增：包含真实姓名
      permissions,
    };

    const token = jwt.sign(payload, config.jwt.secret, {
      expiresIn: config.jwt.expiresIn as any,
    });

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        realName: user.realName,
        role: user.role,
        email: user.email,
        avatarUrl: user.avatarUrl,
        accountStatus: user.accountStatus,  // ✅ 返回状态信息
      },
      permissions,
    });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: '参数错误', errors: err.errors });
    }
    console.error('[auth/login] 服务器错误:', err);
    res.status(500).json({ message: '服务器错误' });
  }
});

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
