/**
 * 审计日志接口鉴权回归测试
 *
 * 背景：`/api/audit` 曾整体无鉴权 —— 任何人都能拉全量审计日志（含操作人、
 * 变更前后数据），并用 `POST /cleanup {"retainDays":0}` 清空全部留痕。
 * 本测试锁定修复后的行为：
 * - 未认证 → 401
 * - 学生 → 403
 * - 教师：不可查询/统计（2026-10-13 起审计日志仅校级管理员可见），也不可删除、不可清理
 * - 管理员：可删除/清理，且 retainDays 有下限（传 0 不会清空全部）
 *
 * authenticate 被替换为「按 x-test-role 头注入用户」，authorize 使用真实实现。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

vi.mock('../../middleware/auth', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    authenticate: (req: any, res: any, next: any) => {
      const role = req.headers['x-test-role'];
      if (!role) return res.status(401).json({ message: '未认证' });
      req.user = { id: 'u-1', userId: 'u-1', username: 'u1', role, permissions: [] };
      next();
    },
  };
});

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    auditLog: { findMany: vi.fn(), count: vi.fn(), groupBy: vi.fn(), delete: vi.fn(), deleteMany: vi.fn() },
  } as any,
}));
vi.mock('../../config/prisma', () => ({ prisma: mockPrisma }));

import { auditRouter } from '../audit';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/audit', auditRouter);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.auditLog.findMany.mockResolvedValue([]);
  mockPrisma.auditLog.count.mockResolvedValue(0);
  mockPrisma.auditLog.groupBy.mockResolvedValue([]);
  mockPrisma.auditLog.deleteMany.mockResolvedValue({ count: 0 });
  mockPrisma.auditLog.delete.mockResolvedValue({});
});

describe('GET /api/audit/logs', () => {
  it('未认证 → 401', async () => {
    const res = await request(makeApp()).get('/api/audit/logs');
    expect(res.status).toBe(401);
  });

  it('学生 → 403', async () => {
    const res = await request(makeApp()).get('/api/audit/logs').set('x-test-role', 'student');
    expect(res.status).toBe(403);
  });

  it('教师 → 403（2026-10-13 起审计日志对教师关闭，设计 §3.1）', async () => {
    const res = await request(makeApp()).get('/api/audit/logs').set('x-test-role', 'teacher');
    expect(res.status).toBe(403);
    expect(mockPrisma.auditLog.findMany).not.toHaveBeenCalled();
  });
});

describe('破坏性操作仅限管理员', () => {
  it('教师删除单条日志 → 403，且不会触达数据库', async () => {
    const res = await request(makeApp())
      .delete('/api/audit/logs/log-1')
      .set('x-test-role', 'teacher');
    expect(res.status).toBe(403);
    expect(mockPrisma.auditLog.delete).not.toHaveBeenCalled();
  });

  it('教师清理日志 → 403，且不会触达数据库', async () => {
    const res = await request(makeApp())
      .post('/api/audit/cleanup')
      .set('x-test-role', 'teacher')
      .send({ retainDays: 0 });
    expect(res.status).toBe(403);
    expect(mockPrisma.auditLog.deleteMany).not.toHaveBeenCalled();
  });

  it('管理员清理时 retainDays 有 30 天下限：传 0 只清理 30 天前的日志', async () => {
    const before = Date.now();
    const res = await request(makeApp())
      .post('/api/audit/cleanup')
      .set('x-test-role', 'admin')
      .send({ retainDays: 0 });
    expect(res.status).toBe(200);

    const cutoff: Date = mockPrisma.auditLog.deleteMany.mock.calls[0][0].where.occurredAt.lt;
    const cutoffDays = (before - cutoff.getTime()) / 86400000;
    expect(cutoffDays).toBeGreaterThanOrEqual(29.9); // 未退化成「清空全部」
    expect(cutoffDays).toBeLessThanOrEqual(30.1);
  });

  it('管理员删除单条日志 → 200', async () => {
    const res = await request(makeApp())
      .delete('/api/audit/logs/log-1')
      .set('x-test-role', 'admin');
    expect(res.status).toBe(200);
    expect(mockPrisma.auditLog.delete).toHaveBeenCalledTimes(1);
  });
});
