/**
 * 题库列表筛选测试：题型多选（type=a,b）
 *
 * 题库列表与试卷选题页的"题型"过滤器共用这一个参数；
 * 非法值必须被忽略而不是把整个查询变成"永远空"，否则前端传错一个枚举值会让教师以为题库是空的。
 *
 * 注：P2 起列表 where 为 `{ AND: conditions }` 组合（业务筛选与数据范围条件并列），
 * 断言统一经 condOf 从 AND 数组取字段条件 —— 保持「筛选值仍被应用」的守卫语义不变。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

/** 从 AND 条件数组里取指定字段的条件值（未设置 = undefined） */
function condOf(where: any, key: string) {
  return (where.AND as any[]).find((c) => c && c[key] !== undefined)?.[key];
}

vi.mock('../../middleware/auth', () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.user = { id: 'u-teacher-1', userId: 'u-teacher-1', username: 'teacher1', role: 'teacher' };
    next();
  },
  authorize: () => (_req: any, _res: any, next: any) => next(),
}));

const { mockPrisma } = vi.hoisted(() => {
  const prisma: any = {
    question: { findMany: vi.fn(), count: vi.fn() },
  };
  return { mockPrisma: prisma };
});

vi.mock('../../config/prisma', () => ({ prisma: mockPrisma }));

import { questionRouter } from '../questions';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/questions', questionRouter);
  return app;
}

describe('GET /api/questions — 题型筛选', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.question.findMany.mockResolvedValue([]);
    mockPrisma.question.count.mockResolvedValue(0);
  });

  it('type 传多个值时按 in 过滤（逗号分隔）', async () => {
    const res = await request(makeApp()).get('/api/questions?type=single_choice,multiple_choice,true_false');

    expect(res.status).toBe(200);
    const where = mockPrisma.question.findMany.mock.calls[0][0].where;
    expect(condOf(where, 'type')).toEqual({ in: ['single_choice', 'multiple_choice', 'true_false'] });
  });

  it('混入非法值时只保留合法题型（不因一个错值过滤掉全部）', async () => {
    const res = await request(makeApp()).get('/api/questions?type=single_choice,bogus_type');

    expect(res.status).toBe(200);
    const where = mockPrisma.question.findMany.mock.calls[0][0].where;
    expect(condOf(where, 'type')).toEqual({ in: ['single_choice'] });
  });

  it('全部为非法值时等同不传（不生成 type 条件）', async () => {
    const res = await request(makeApp()).get('/api/questions?type=bogus_type');

    expect(res.status).toBe(200);
    const where = mockPrisma.question.findMany.mock.calls[0][0].where;
    expect(condOf(where, 'type')).toBeUndefined();
  });
});

describe('GET /api/questions — 来源筛选（官方题库/校本题库页签）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.question.findMany.mockResolvedValue([]);
    mockPrisma.question.count.mockResolvedValue(0);
  });

  it('source=official 时按来源过滤', async () => {
    const res = await request(makeApp()).get('/api/questions?source=official');

    expect(res.status).toBe(200);
    const where = mockPrisma.question.findMany.mock.calls[0][0].where;
    expect(condOf(where, 'source')).toBe('official');
  });

  it('不传 source 时不过滤（全部页签）', async () => {
    const res = await request(makeApp()).get('/api/questions');

    expect(res.status).toBe(200);
    const where = mockPrisma.question.findMany.mock.calls[0][0].where;
    expect(condOf(where, 'source')).toBeUndefined();
  });
});
