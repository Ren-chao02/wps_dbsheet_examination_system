/**
 * 批次读路径的数据范围回归测试（P2 · Task 8，P1 终审发现的漏口）。
 *
 * 锁定：教师只能读「我创建」的批次列表/详情；admin 不受限。
 * 口径与写路径 checkBatchAccess（admin 或创建者放行）一致 —— 批次级联发布/收卷影响面大，
 * 读路径不能反而比写路径更宽。
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

// autoEndExpiredExams 会扫全表收卷，测试里直接短路
vi.mock('../../utils/exam-utils', () => ({
  autoEndExpiredExams: vi.fn().mockResolvedValue(undefined),
  finalizeExamSubmissions: vi.fn().mockResolvedValue(undefined),
}));

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    examBatch: { findMany: vi.fn(), count: vi.fn(), findUnique: vi.fn() },
  } as any,
}));
vi.mock('../../config/prisma', () => ({ prisma: mockPrisma }));

import { batchRouter } from '../batches';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/batches', batchRouter);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.examBatch.findMany.mockResolvedValue([]);
  mockPrisma.examBatch.count.mockResolvedValue(0);
  mockPrisma.examBatch.findUnique.mockResolvedValue(null);
});

describe('GET /api/batches 列表范围', () => {
  it('教师 → where 携带「我创建」条件', async () => {
    const res = await request(makeApp())
      .get('/api/batches')
      .set('x-test-role', 'teacher')
      .set('x-test-user', 't-1');

    expect(res.status).toBe(200);
    const arg = mockPrisma.examBatch.findMany.mock.calls[0][0];
    expect(arg.where.AND[0]).toEqual({ createdBy: 't-1' });
    // count 必须用同一 where，否则分页总数泄露范围外数量
    expect(mockPrisma.examBatch.count).toHaveBeenCalledWith({ where: arg.where });
  });

  it('admin → 无范围过滤（AND[0] 为空对象）', async () => {
    const res = await request(makeApp()).get('/api/batches').set('x-test-role', 'admin');

    expect(res.status).toBe(200);
    const arg = mockPrisma.examBatch.findMany.mock.calls[0][0];
    expect(arg.where.AND).toEqual([{}]);
  });

  it('教师带筛选条件 → 范围条件与业务条件用 AND 组合（keyword 的 OR 不被覆盖）', async () => {
    const res = await request(makeApp())
      .get('/api/batches?status=active&keyword=期末')
      .set('x-test-role', 'teacher')
      .set('x-test-user', 't-1');

    expect(res.status).toBe(200);
    const arg = mockPrisma.examBatch.findMany.mock.calls[0][0];
    expect(arg.where.AND[0]).toEqual({ createdBy: 't-1' });
    expect(arg.where.AND[1]).toEqual({ status: 'active' });
    expect(arg.where.AND[2]).toEqual({
      OR: [
        { name: { contains: '期末', mode: 'insensitive' } },
        { description: { contains: '期末', mode: 'insensitive' } },
      ],
    });
  });
});

describe('GET /api/batches/:id 详情范围', () => {
  it('他人批次 → 403', async () => {
    mockPrisma.examBatch.findUnique.mockResolvedValue({
      id: 'b-1',
      createdBy: 't-9',
      exams: [],
    });

    const res = await request(makeApp())
      .get('/api/batches/b-1')
      .set('x-test-role', 'teacher')
      .set('x-test-user', 't-1');

    expect(res.status).toBe(403);
    expect(res.body.message).toBe('无权查看该批次，请联系批次创建者或管理员');
  });

  it('创建者本人 → 200', async () => {
    mockPrisma.examBatch.findUnique.mockResolvedValue({
      id: 'b-1',
      createdBy: 't-1',
      exams: [],
    });

    const res = await request(makeApp())
      .get('/api/batches/b-1')
      .set('x-test-role', 'teacher')
      .set('x-test-user', 't-1');

    expect(res.status).toBe(200);
    expect(res.body.id).toBe('b-1');
  });

  it('admin → 他人批次也放行', async () => {
    mockPrisma.examBatch.findUnique.mockResolvedValue({
      id: 'b-1',
      createdBy: 't-9',
      exams: [],
    });

    const res = await request(makeApp()).get('/api/batches/b-1').set('x-test-role', 'admin');

    expect(res.status).toBe(200);
    expect(res.body.id).toBe('b-1');
  });

  it('批次不存在 → 404（不是 403，避免把「改错 ID」报成权限问题）', async () => {
    mockPrisma.examBatch.findUnique.mockResolvedValue(null);

    const res = await request(makeApp())
      .get('/api/batches/b-not-exist')
      .set('x-test-role', 'teacher')
      .set('x-test-user', 't-1');

    expect(res.status).toBe(404);
  });
});
