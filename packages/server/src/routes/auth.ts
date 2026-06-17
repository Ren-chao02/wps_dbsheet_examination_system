import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { prisma } from '../config/prisma';
import { config } from '../config';
import { authenticate, JwtPayload, getUserPermissions } from '../middleware/auth';

export const authRouter = Router();

const loginSchema = z.object({
  username: z.string().min(2).max(64),
  password: z.string().min(6),
});

const registerSchema = z.object({
  username: z.string().min(2).max(64),
  password: z.string().min(6),
  realName: z.string().optional(),
  email: z.string().email().optional(),
  role: z.enum(['teacher', 'student']).default('student'),
});

// POST /api/auth/login
authRouter.post('/login', async (req: Request, res: Response) => {
  try {
    const { username, password } = loginSchema.parse(req.body);

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
    res.status(500).json({ message: '服务器错误' });
  }
});

// POST /api/auth/register
authRouter.post('/register', async (req: Request, res: Response) => {
  try {
    const data = registerSchema.parse(req.body);

    const existing = await prisma.user.findUnique({ where: { username: data.username } });
    if (existing) {
      return res.status(409).json({ message: '用户名已存在' });
    }

    const passwordHash = await bcrypt.hash(data.password, 10);
    const user = await prisma.user.create({
      data: {
        username: data.username,
        passwordHash,
        realName: data.realName,
        email: data.email,
        role: data.role,
      },
    });

    res.status(201).json({
      id: user.id,
      username: user.username,
      realName: user.realName,
      role: user.role,
      email: user.email,
    });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: '参数错误', errors: err.errors });
    }
    res.status(500).json({ message: '服务器错误' });
  }
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
