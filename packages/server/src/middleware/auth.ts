import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { prisma } from '../config/prisma';

export interface JwtPayload {
  userId: string;
  username: string;
  role: string;
  realName?: string;  // ✅ 新增：支持用户真实姓名
  permissions?: string[];
}

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

export async function authenticate(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: '未提供认证令牌' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const payload = jwt.verify(token, config.jwt.secret) as JwtPayload;

    // ✅ 新增：实时查询数据库验证账号状态
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { id: true, accountStatus: true },
    });

    if (!user) {
      return res.status(401).json({ message: '用户不存在' });
    }

    if (user.accountStatus === 'DISABLED') {
      return res.status(403).json({
        message: '账号已被禁用，请联系管理员',
        code: 'ACCOUNT_DISABLED',
      });
    }

    req.user = payload;
    next();
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      return res.status(401).json({ message: '认证令牌已过期，请重新登录' });
    }
    if (err instanceof jwt.JsonWebTokenError) {
      return res.status(401).json({ message: '认证令牌无效' });
    }
    return res.status(401).json({ message: '认证令牌验证失败' });
  }
}

export function authorize(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ message: '未认证' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ message: '权限不足' });
    }
    next();
  };
}

/**
 * 基于模块权限的授权中间件
 * - admin 角色直接放行（超级管理员兜底）
 * - 否则从 JWT permissions 或数据库中检查权限
 */
export function authorizePermission(...requiredModules: string[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ message: '未认证' });
    }

    // admin 角色兜底放行
    if (req.user.role === 'admin') {
      return next();
    }

    // 优先从 JWT payload 中取权限
    let permissions = req.user.permissions;

    // 如果 JWT 中没有 permissions，从数据库查
    if (!permissions) {
      try {
        const user = await prisma.user.findUnique({
          where: { id: req.user.userId },
          select: {
            systemRole: {
              select: {
                permissions: { select: { moduleCode: true } },
              },
            },
          },
        });
        permissions = user?.systemRole?.permissions.map((p) => p.moduleCode) || [];
      } catch {
        return res.status(500).json({ message: '权限查询失败' });
      }
    }

    // 检查是否拥有所有必需模块权限
    const hasAll = requiredModules.every((m) => permissions!.includes(m));
    if (!hasAll) {
      return res.status(403).json({ message: '权限不足' });
    }

    next();
  };
}

/**
 * 根据用户ID获取权限列表（用于登录时生成 JWT）
 */
export async function getUserPermissions(userId: string): Promise<string[]> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      role: true,
      systemRole: {
        select: {
          permissions: { select: { moduleCode: true } },
        },
      },
    },
  });

  if (!user) return [];

  // admin 角色返回全部权限
  if (user.role === 'admin') {
    const { SYSTEM_MODULES } = await import('../constants/modules');
    return SYSTEM_MODULES.map((m) => m.code);
  }

  return user.systemRole?.permissions.map((p) => p.moduleCode) || [];
}
