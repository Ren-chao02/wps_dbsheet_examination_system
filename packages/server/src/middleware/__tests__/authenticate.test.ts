/**
 * authenticate 改造回归（P2）：role 与 departmentId 以数据库为准，覆盖 JWT 中可能过期的值。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import jwt from 'jsonwebtoken';

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: { user: { findUnique: vi.fn() } } as any,
}));
vi.mock('../../config/prisma', () => ({ prisma: mockPrisma }));

import { authenticate } from '../auth';
import { config } from '../../config';

function makeReqRes(token: string) {
  const req: any = { headers: { authorization: `Bearer ${token}` } };
  let statusCode = 200; let body: any;
  const res: any = { status: (c: number) => { statusCode = c; return res; }, json: (b: any) => { body = b; return res; } };
  return { req, res, get: () => ({ statusCode, body }) };
}

beforeEach(() => vi.clearAllMocks());

describe('authenticate 的 DB 权威字段', () => {
  it('JWT 里是 admin，但库里已被降为 teacher → req.user.role 以库为准', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'u-1', accountStatus: 'ENABLED', role: 'teacher', departmentId: 'd-1' });
    const token = jwt.sign({ id: 'u-1', userId: 'u-1', username: 'u1', role: 'admin' }, config.jwt.secret, { expiresIn: '1h' });
    const { req, res, get } = makeReqRes(token);
    let nexted = false;
    await authenticate(req, res, () => { nexted = true; });
    expect(nexted).toBe(true);
    expect(req.user.role).toBe('teacher');
    expect(req.user.departmentId).toBe('d-1');
  });

  it('账号被禁用仍 403（既有行为不回退）', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'u-1', accountStatus: 'DISABLED', role: 'teacher', departmentId: null });
    const token = jwt.sign({ id: 'u-1', userId: 'u-1', username: 'u1', role: 'teacher' }, config.jwt.secret, { expiresIn: '1h' });
    const { req, res, get } = makeReqRes(token);
    await authenticate(req, res, () => { });
    expect(get().statusCode).toBe(403);
  });
});
