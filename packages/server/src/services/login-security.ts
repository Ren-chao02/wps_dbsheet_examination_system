import jwt from 'jsonwebtoken';
import { prisma } from '../config/prisma';
import { config } from '../config';
import type { User } from '@prisma/client';

/**
 * 登录安全：身份查找、失败计数/锁定、JWT 签发。
 *
 * 这里只做「登录链路」的纯逻辑，不碰 HTTP；路由层负责验证码、审计与响应。
 */

/** 用户名 / 学号 / 工号都可作为登录标识；优先级 username > studentId > employeeId */
export async function findUserByIdentifier(identifier: string): Promise<User | null> {
  const byUsername = await prisma.user.findUnique({ where: { username: identifier } });
  if (byUsername) return byUsername;

  const byStudentId = await prisma.user.findUnique({ where: { studentId: identifier } });
  if (byStudentId) return byStudentId;

  return prisma.user.findUnique({ where: { employeeId: identifier } });
}

/**
 * 返回仍在生效的锁定截止时间；如果锁定已过期，顺手清零失败计数。
 * 返回 null 表示可以继续验证密码。
 */
export async function getActiveLock(user: Pick<User, 'id' | 'lockedUntil'>): Promise<Date | null> {
  if (!user.lockedUntil) return null;
  if (user.lockedUntil.getTime() > Date.now()) return user.lockedUntil;

  await resetLoginFailures(user.id);
  return null;
}

export interface FailedLoginResult {
  attempts: number;
  lockedUntil: Date | null;
}

/**
 * 记录一次失败。达到阈值时写入 lockedUntil。
 * 用数据库自增而不是「读-改-写」，并发下不会丢计数。
 */
export async function recordFailedLogin(userId: string): Promise<FailedLoginResult> {
  const updated = await prisma.user.update({
    where: { id: userId },
    data: { failedLoginAttempts: { increment: 1 } },
    select: { failedLoginAttempts: true },
  });

  if (updated.failedLoginAttempts >= config.login.maxFailedAttempts) {
    const lockedUntil = new Date(Date.now() + config.login.lockMinutes * 60 * 1000);
    await prisma.user.update({
      where: { id: userId },
      data: { lockedUntil },
    });
    return { attempts: updated.failedLoginAttempts, lockedUntil };
  }

  return { attempts: updated.failedLoginAttempts, lockedUntil: null };
}

/** 登录成功（或锁定过期）后清零失败状态 */
export async function resetLoginFailures(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { failedLoginAttempts: 0, lockedUntil: null },
  });
}

export async function markLoginSuccess(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
  });
}

export interface SignedToken {
  token: string;
  expiresIn: string;
}

/** rememberMe 为 true 时签发 7 天 token，否则沿用默认有效期 */
export function signAuthToken(
  user: Pick<User, 'id' | 'username' | 'role' | 'realName'>,
  permissions: string[],
  rememberMe = false,
): SignedToken {
  const expiresIn = rememberMe ? config.jwt.rememberExpiresIn : config.jwt.expiresIn;
  const payload = {
    id: user.id,
    userId: user.id,
    username: user.username,
    role: user.role,
    realName: user.realName || undefined,
    permissions,
  };
  const token = jwt.sign(payload, config.jwt.secret, { expiresIn: expiresIn as any });
  return { token, expiresIn };
}
