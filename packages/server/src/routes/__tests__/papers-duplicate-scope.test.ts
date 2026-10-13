/**
 * 复制试卷的数据范围回归测试（P1）：他人校本试卷不可复制，官方试卷可复制。
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
      const userId = (req.headers['x-test-user'] as string) || 'u-1';
      req.user = { id: userId, userId, username: userId, role, permissions: [] };
      next();
    },
  };
});

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    paper: { findUnique: vi.fn(), create: vi.fn() },
  } as any,
}));
vi.mock('../../config/prisma', () => ({ prisma: mockPrisma }));

import { paperRouter } from '../papers';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/papers', paperRouter);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.paper.create.mockResolvedValue({ id: 'p-new', name: '副本' });
});

describe('POST /api/papers/:id/duplicate', () => {
  it('复制他人校本试卷 → 403', async () => {
    mockPrisma.paper.findUnique.mockResolvedValue({ id: 'p-1', name: '他人卷', source: 'school', createdBy: 't-1', paperQuestions: [] });
    const res = await request(makeApp())
      .post('/api/papers/p-1/duplicate')
      .set('x-test-role', 'teacher')
      .set('x-test-user', 't-2');
    expect(res.status).toBe(403);
    expect(mockPrisma.paper.create).not.toHaveBeenCalled();
  });

  it('复制官方试卷 → 201', async () => {
    mockPrisma.paper.findUnique.mockResolvedValue({ id: 'p-2', name: '官方卷', source: 'official', createdBy: 'admin-1', paperQuestions: [] });
    const res = await request(makeApp())
      .post('/api/papers/p-2/duplicate')
      .set('x-test-role', 'teacher')
      .set('x-test-user', 't-2');
    expect(res.status).toBe(201);
    expect(mockPrisma.paper.create).toHaveBeenCalledTimes(1);
  });

  it('复制自己的试卷 → 201', async () => {
    mockPrisma.paper.findUnique.mockResolvedValue({ id: 'p-3', name: '我的卷', source: 'school', createdBy: 't-2', paperQuestions: [] });
    const res = await request(makeApp())
      .post('/api/papers/p-3/duplicate')
      .set('x-test-role', 'teacher')
      .set('x-test-user', 't-2');
    expect(res.status).toBe(201);
  });
});
