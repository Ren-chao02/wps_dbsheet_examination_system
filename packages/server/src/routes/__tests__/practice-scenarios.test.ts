/**
 * 场景列表接口：只出题数 ≥ 2 的场景（单题场景走自由练习），
 * 并带上该生「进行中」与「最近一次完成」两种记录，供卡片显示进度。
 */
import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import express from 'express';

vi.mock('../../middleware/auth', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    authenticate: (req: any, _res: any, next: any) => {
      req.user = { id: 's-1', userId: 's-1', username: 's-1', role: 'student', permissions: [], departmentId: null };
      next();
    },
  };
});

// vi.mock 的 factory 会被提升到文件顶部执行，引用顶层 const 会踩 TDZ
// （Cannot access 'groupBy' before initialization），故用 vi.hoisted 建桩
const { groupBy, findMany } = vi.hoisted(() => ({
  groupBy: vi.fn().mockResolvedValue([
    { scenario: '员工信息表', _count: { _all: 19 }, _sum: { score: 190 } },
    { scenario: '孤立场景', _count: { _all: 1 }, _sum: { score: 10 } },
  ]),
  findMany: vi.fn().mockResolvedValue([
    {
      id: 'rec-1', status: 'in_progress', score: null, maxScore: 190, passed: null,
      startedAt: new Date('2026-10-14T01:00:00Z'), submittedAt: null,
      questions: [{ questionId: 'q1', scenarioKey: '员工信息表' }],
    },
  ]),
}));

vi.mock('../../config/prisma', () => ({
  prisma: {
    question: { groupBy },
    practiceRecord: { findMany, findFirst: vi.fn().mockResolvedValue(null) },
    practiceTableAssignment: { findUnique: vi.fn().mockResolvedValue({ fileId: 'f-1', shareUrl: 'u' }) },
  },
}));

import { practiceRouter } from '../practice';

const app = express();
app.use(express.json());
app.use('/api/practice', practiceRouter);

describe('GET /api/practice/scenarios', () => {
  it('过滤掉单题场景，并带出进行中的记录', async () => {
    const res = await request(app).get('/api/practice/scenarios');
    expect(res.status).toBe(200);
    const keys = res.body.scenarios.map((s: any) => s.key);
    expect(keys).toEqual(['员工信息表']);
    const s = res.body.scenarios[0];
    expect(s.questionCount).toBe(19);
    expect(s.totalScore).toBe(190);
    expect(s.running).toEqual({ recordId: 'rec-1', startedAt: '2026-10-14T01:00:00.000Z' });
  });

  // 卡片徽标的另一种状态：做完并判过分 → latest（简报只覆盖了 running，这条补上得分映射）
  it('已判分的记录走 latest（带得分/通过），running 缺省', async () => {
    findMany.mockResolvedValueOnce([
      {
        id: 'rec-2', status: 'graded', score: 150, maxScore: 190, passed: true,
        startedAt: new Date('2026-10-13T01:00:00Z'), submittedAt: new Date('2026-10-13T01:30:00Z'),
        questions: [{ questionId: 'q1', scenarioKey: '员工信息表' }],
      },
    ]);
    const res = await request(app).get('/api/practice/scenarios');
    expect(res.status).toBe(200);
    const s = res.body.scenarios[0];
    expect(s.running).toBeUndefined();
    expect(s.latest).toEqual({
      recordId: 'rec-2', score: 150, maxScore: 190, passed: true,
      submittedAt: '2026-10-13T01:30:00.000Z',
    });
  });
});
