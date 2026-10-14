/**
 * 题库「场景」相关路由测试（场景清单 + 场景筛选）
 *
 * 两个容易回归的点在这里钉住：
 * 1. `/scenarios` 必须注册在 `/:id` 之前 —— 否则 "scenarios" 会被当成题目 id
 *    （本文件用「findUnique 未被调用」把这条顺序显式锁住）。
 * 2. 场景清单的题数必须按当前用户可见范围统计，否则筛选器会出现
 *    "选了这个场景却一道题都没有"的假选项。
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
    authorize: () => (_req: any, _res: any, next: any) => next(),
  };
});

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    question: { findMany: vi.fn(), count: vi.fn(), groupBy: vi.fn(), findUnique: vi.fn() },
  } as any,
}));
vi.mock('../../config/prisma', () => ({ prisma: mockPrisma }));

import { questionRouter } from '../questions';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/questions', questionRouter);
  return app;
}

/** 从 AND 条件数组里取指定字段的条件值（未设置 = undefined） */
function condOf(where: any, key: string) {
  return (where.AND as any[]).find((c) => c && c[key] !== undefined)?.[key];
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.question.findMany.mockResolvedValue([]);
  mockPrisma.question.count.mockResolvedValue(0);
  mockPrisma.question.groupBy.mockResolvedValue([]);
  mockPrisma.question.findUnique.mockResolvedValue(null);
});

describe('GET /api/questions/scenarios — 场景清单', () => {
  it('走 /scenarios 而不是被 /:id 吞掉，返回去掉空场景后的 名字+题数', async () => {
    mockPrisma.question.groupBy.mockResolvedValue([
      { scenario: '员工信息表', _count: { _all: 20 } },
      { scenario: null, _count: { _all: 3 } },
      { scenario: '', _count: { _all: 1 } },
    ]);

    const res = await request(makeApp())
      .get('/api/questions/scenarios')
      .set('x-test-role', 'teacher')
      .set('x-test-user', 't-1');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ scenario: '员工信息表', count: 20 }]);
    // 路由顺序守卫：命中 /:id 时才会出现 findUnique 调用（且 "scenarios" 不是合法题目）
    expect(mockPrisma.question.findUnique).not.toHaveBeenCalled();
  });

  it('题数按当前用户可见范围统计（与列表同一套 where）', async () => {
    const res = await request(makeApp())
      .get('/api/questions/scenarios')
      .set('x-test-role', 'teacher')
      .set('x-test-user', 't-1');

    expect(res.status).toBe(200);
    const where = mockPrisma.question.groupBy.mock.calls[0][0].where;
    expect((where.AND as any[])[0]).toEqual({ scenario: { not: null } });
    expect((where.AND as any[])[1]).toEqual({
      OR: [
        { createdBy: 't-1' },
        { departmentId: 'd-1' },
        { departmentId: null },
        { sharedToSchool: true },
      ],
    });
  });
});

describe('GET /api/questions — 场景筛选', () => {
  it('scenario 传值时按场景过滤', async () => {
    const res = await request(makeApp())
      .get('/api/questions?scenario=' + encodeURIComponent('员工信息表'))
      .set('x-test-role', 'teacher');

    expect(res.status).toBe(200);
    const where = mockPrisma.question.findMany.mock.calls[0][0].where;
    expect(condOf(where, 'scenario')).toBe('员工信息表');
  });

  it('不传 scenario 时不过滤', async () => {
    const res = await request(makeApp())
      .get('/api/questions')
      .set('x-test-role', 'teacher');

    expect(res.status).toBe(200);
    const where = mockPrisma.question.findMany.mock.calls[0][0].where;
    expect(condOf(where, 'scenario')).toBeUndefined();
  });

  it('列表每行带上 unsupportedActions（引擎不认识的规则的 action 名）', async () => {
    mockPrisma.question.findMany.mockResolvedValue([
      { id: 'q-ok', answerRules: [{ id: 'r1', action: 'check_field', params: {}, score: 10 }] },
      { id: 'q-bad', answerRules: [{ id: 'r2', action: 'verify_dashboard', params: {}, score: 10 }] },
      { id: 'q-none', answerRules: [] },
    ]);

    const res = await request(makeApp())
      .get('/api/questions')
      .set('x-test-role', 'teacher');

    expect(res.status).toBe(200);
    expect(res.body.data.map((q: any) => [q.id, q.unsupportedActions])).toEqual([
      ['q-ok', []],
      ['q-bad', ['verify_dashboard']],
      ['q-none', []],
    ]);
  });
});
