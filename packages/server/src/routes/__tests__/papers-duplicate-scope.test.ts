/**
 * 复制试卷的数据范围回归测试（P2：由 P1 的「本人或官方」演进为「可读即可复制」）。
 *
 * P1 口径：只有「本人创建」或「官方」可复制，他人校本试卷一律 403；
 * P2 口径（计划明文要求的语义演进，非放宽松后的妥协）：**可读即可复制** ——
 *   自己 ∪ 本院系 ∪ 校级(departmentId 为空) ∪ 上架校级池(sharedToSchool)，
 * 复制出的新卷归属复制者院系（departmentId = 复制者院系）。
 * 因此「他人校本」拆成四类：他院系未上架 403；同院系 / 校级 / 上架 均 201；
 * 官方试卷作为校级资产（迁移回填后 departmentId 为空）仍可复制（保留）。
 *
 * 注：assertPaperRead 从 req.user 取 departmentId（authenticate 的数据库权威值），
 * 因此 authenticate mock 必须在 req.user 上带 departmentId。
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
      // 默认注入院系 d-1；需要「无院系（校级）」场景时传 x-test-dept: none
      const dept = req.headers['x-test-dept'] as string | undefined;
      req.user = {
        id: userId,
        userId,
        username: userId,
        role,
        permissions: [],
        departmentId: dept === 'none' ? null : (dept ?? 'd-1'),
      };
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
  it('复制他院系且未上架的试卷 → 403，且不落库', async () => {
    mockPrisma.paper.findUnique.mockResolvedValue({
      id: 'p-1', name: '他人卷', source: 'school', createdBy: 't-1',
      departmentId: 'd-9', sharedToSchool: false, paperQuestions: [],
    });
    const res = await request(makeApp())
      .post('/api/papers/p-1/duplicate')
      .set('x-test-role', 'teacher')
      .set('x-test-user', 't-2');
    expect(res.status).toBe(403);
    expect(res.body.message).toBe('该试卷不在你可见的范围内，无法复制');
    expect(mockPrisma.paper.create).not.toHaveBeenCalled();
  });

  it('复制同院系试卷（他人创建）→ 201，新卷归属复制者院系', async () => {
    mockPrisma.paper.findUnique.mockResolvedValue({
      id: 'p-2', name: '院系卷', source: 'school', createdBy: 't-1',
      departmentId: 'd-1', sharedToSchool: false, paperQuestions: [],
    });
    const res = await request(makeApp())
      .post('/api/papers/p-2/duplicate')
      .set('x-test-role', 'teacher')
      .set('x-test-user', 't-2');
    expect(res.status).toBe(201);
    const data = mockPrisma.paper.create.mock.calls[0][0].data;
    expect(data.createdBy).toBe('t-2');
    expect(data.departmentId).toBe('d-1');
  });

  it('复制校级试卷（departmentId 为空）→ 201', async () => {
    mockPrisma.paper.findUnique.mockResolvedValue({
      id: 'p-3', name: '校级卷', source: 'school', createdBy: 't-1',
      departmentId: null, sharedToSchool: false, paperQuestions: [],
    });
    const res = await request(makeApp())
      .post('/api/papers/p-3/duplicate')
      .set('x-test-role', 'teacher')
      .set('x-test-user', 't-2');
    expect(res.status).toBe(201);
  });

  it('复制已上架校级池的试卷（他院系但 sharedToSchool）→ 201', async () => {
    mockPrisma.paper.findUnique.mockResolvedValue({
      id: 'p-4', name: '上架卷', source: 'school', createdBy: 't-1',
      departmentId: 'd-9', sharedToSchool: true, paperQuestions: [],
    });
    const res = await request(makeApp())
      .post('/api/papers/p-4/duplicate')
      .set('x-test-role', 'teacher')
      .set('x-test-user', 't-2');
    expect(res.status).toBe(201);
  });

  it('复制官方试卷 → 201（保留：官方卷是校级资产，departmentId 为空）', async () => {
    mockPrisma.paper.findUnique.mockResolvedValue({
      id: 'p-5', name: '官方卷', source: 'official', createdBy: 'admin-1',
      departmentId: null, sharedToSchool: false, paperQuestions: [],
    });
    const res = await request(makeApp())
      .post('/api/papers/p-5/duplicate')
      .set('x-test-role', 'teacher')
      .set('x-test-user', 't-2');
    expect(res.status).toBe(201);
    expect(mockPrisma.paper.create).toHaveBeenCalledTimes(1);
  });

  it('复制自己的试卷 → 201', async () => {
    mockPrisma.paper.findUnique.mockResolvedValue({
      id: 'p-6', name: '我的卷', source: 'school', createdBy: 't-2',
      departmentId: 'd-1', sharedToSchool: false, paperQuestions: [],
    });
    const res = await request(makeApp())
      .post('/api/papers/p-6/duplicate')
      .set('x-test-role', 'teacher')
      .set('x-test-user', 't-2');
    expect(res.status).toBe(201);
  });
});
