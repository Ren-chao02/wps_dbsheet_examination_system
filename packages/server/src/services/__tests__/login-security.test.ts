import { beforeEach, describe, expect, it, vi } from 'vitest';
import jwt from 'jsonwebtoken';

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock('../../config/prisma', () => ({ prisma: mockPrisma }));

import { config } from '../../config';
import {
  findUserByIdentifier,
  getActiveLock,
  markLoginSuccess,
  recordFailedLogin,
  signAuthToken,
} from '../login-security';

const USER = {
  id: 'u-1',
  username: '20252861',
  passwordHash: 'hash',
  realName: '张三',
  role: 'student',
  accountStatus: 'ENABLED',
  failedLoginAttempts: 0,
  lockedUntil: null,
};

describe('登录安全服务', () => {
  beforeEach(() => {
    // 用 reset 而不是 clear：mockResolvedValueOnce 的队列也要清掉，否则会串到下一个用例
    vi.resetAllMocks();
  });

  describe('findUserByIdentifier', () => {
    it('优先按用户名查找，找不到再按学号、工号', async () => {
      mockPrisma.user.findUnique
        .mockResolvedValueOnce(null) // username
        .mockResolvedValueOnce(USER) // studentId
        .mockResolvedValueOnce(null); // employeeId

      const user = await findUserByIdentifier('20252861');

      expect(user).toEqual(USER);
      expect(mockPrisma.user.findUnique).toHaveBeenNthCalledWith(1, {
        where: { username: '20252861' },
      });
      expect(mockPrisma.user.findUnique).toHaveBeenNthCalledWith(2, {
        where: { studentId: '20252861' },
      });
      expect(mockPrisma.user.findUnique).toHaveBeenCalledTimes(2);
    });

    it('用户名命中时不再查学号/工号', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(USER);
      await findUserByIdentifier('20252861');
      expect(mockPrisma.user.findUnique).toHaveBeenCalledTimes(1);
    });
  });

  describe('recordFailedLogin', () => {
    it('未达阈值只自增，不写锁定时间', async () => {
      mockPrisma.user.update.mockResolvedValueOnce({ failedLoginAttempts: 3 });
      const result = await recordFailedLogin('u-1');
      expect(result).toEqual({ attempts: 3, lockedUntil: null });
      expect(mockPrisma.user.update).toHaveBeenCalledTimes(1);
    });

    it('达到 10 次写入 15 分钟锁定', async () => {
      const before = Date.now();
      mockPrisma.user.update
        .mockResolvedValueOnce({ failedLoginAttempts: 10 })
        .mockResolvedValueOnce({});

      const result = await recordFailedLogin('u-1');

      expect(result.attempts).toBe(10);
      expect(result.lockedUntil).toBeInstanceOf(Date);
      const diffMinutes = (result.lockedUntil!.getTime() - before) / 60000;
      expect(diffMinutes).toBeGreaterThan(14.9);
      expect(diffMinutes).toBeLessThan(15.1);
      expect(mockPrisma.user.update).toHaveBeenNthCalledWith(2, {
        where: { id: 'u-1' },
        data: { lockedUntil: result.lockedUntil },
      });
    });
  });

  describe('getActiveLock', () => {
    it('锁定未过期时返回截止时间', async () => {
      const until = new Date(Date.now() + 5 * 60 * 1000);
      await expect(getActiveLock({ id: 'u-1', lockedUntil: until })).resolves.toEqual(until);
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('锁定已过期时清零并返回 null', async () => {
      mockPrisma.user.update.mockResolvedValueOnce({});
      const past = new Date(Date.now() - 1000);
      await expect(getActiveLock({ id: 'u-1', lockedUntil: past })).resolves.toBeNull();
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u-1' },
        data: { failedLoginAttempts: 0, lockedUntil: null },
      });
    });
  });

  describe('signAuthToken', () => {
    it('默认按 JWT_EXPIRES_IN 签发', () => {
      const { token } = signAuthToken(USER as any, ['exam'], false);
      const payload = jwt.verify(token, config.jwt.secret) as any;
      const ttl = payload.exp - payload.iat;
      // 默认 24h（允许配置覆盖，这里断言与配置一致）
      const expected = ttlFrom(config.jwt.expiresIn);
      expect(Math.abs(ttl - expected)).toBeLessThanOrEqual(1);
    });

    it('rememberMe 时签发 7 天', () => {
      const { token } = signAuthToken(USER as any, ['exam'], true);
      const payload = jwt.verify(token, config.jwt.secret) as any;
      const ttl = payload.exp - payload.iat;
      expect(Math.abs(ttl - ttlFrom(config.jwt.rememberExpiresIn))).toBeLessThanOrEqual(1);
    });
  });

  it('markLoginSuccess 清零失败状态并写 lastLoginAt', async () => {
    mockPrisma.user.update.mockResolvedValueOnce({});
    await markLoginSuccess('u-1');
    const call = mockPrisma.user.update.mock.calls[0][0];
    expect(call.data.failedLoginAttempts).toBe(0);
    expect(call.data.lockedUntil).toBeNull();
    expect(call.data.lastLoginAt).toBeInstanceOf(Date);
  });
});

function ttlFrom(expiresIn: string): number {
  const match = /^(\d+)([smhd])$/.exec(expiresIn);
  if (!match) return 24 * 3600;
  const value = Number(match[1]);
  const unit = match[2];
  return value * ({ s: 1, m: 60, h: 3600, d: 86400 }[unit] || 1);
}
