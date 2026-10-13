/**
 * 试卷库/组卷接口测试
 *
 * 覆盖三处"列表页与组卷页依赖、但容易静默失效"的行为：
 * - GET  /api/papers               列表附带组卷方式统计 slotStats（fixed/rule 题位数）
 * - POST /api/papers/:id/duplicate 复制试卷必须保留 slotType 与抽题规则
 * - POST /api/papers/slot-preview  返回各难度可用题数（组卷规则行数量框的 /N）
 *
 * 通过 vi.mock 替换 authenticate/authorize（免 JWT）与 config/prisma（免 DB）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

vi.mock('../../middleware/auth', () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.user = { id: 'u-teacher-1', userId: 'u-teacher-1', username: 'teacher1', role: 'teacher' };
    next();
  },
  authorize: () => (_req: any, _res: any, next: any) => next(),
}));

const { mockPrisma } = vi.hoisted(() => {
  const prisma: any = {
    paper: { findMany: vi.fn(), count: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    paperQuestion: { groupBy: vi.fn(), deleteMany: vi.fn(), createMany: vi.fn(), count: vi.fn() },
    question: { findMany: vi.fn() },
  };
  return { mockPrisma: prisma };
});

vi.mock('../../config/prisma', () => ({ prisma: mockPrisma }));

import { paperRouter } from '../papers';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/papers', paperRouter);
  return app;
}

describe('GET /api/papers — 组卷方式统计', () => {
  beforeEach(() => vi.clearAllMocks());

  it('每张试卷附带 fixed/rule 题位数（slotStats）', async () => {
    mockPrisma.paper.findMany.mockResolvedValue([
      { id: 'p1', name: '甲卷' },
      { id: 'p2', name: '乙卷' },
    ]);
    mockPrisma.paper.count.mockResolvedValue(2);
    mockPrisma.paperQuestion.groupBy.mockResolvedValue([
      { paperId: 'p1', slotType: 'fixed', _count: { _all: 3 } },
      { paperId: 'p1', slotType: 'rule', _count: { _all: 2 } },
      { paperId: 'p2', slotType: 'fixed', _count: { _all: 5 } },
    ]);

    const res = await request(makeApp()).get('/api/papers');

    expect(res.status).toBe(200);
    expect(res.body.data[0].slotStats).toEqual({ fixed: 3, rule: 2 });
    expect(res.body.data[1].slotStats).toEqual({ fixed: 5, rule: 0 });
  });

  it('本页没有试卷时跳过 groupBy（避免 in: [] 空查询）', async () => {
    mockPrisma.paper.findMany.mockResolvedValue([]);
    mockPrisma.paper.count.mockResolvedValue(0);

    const res = await request(makeApp()).get('/api/papers');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(mockPrisma.paperQuestion.groupBy).not.toHaveBeenCalled();
  });
});

describe('PUT /api/papers/:id — 更新试卷（清空可空字段）', () => {
  beforeEach(() => vi.clearAllMocks());

  it('description/difficulty 传 null 表示清空（此前会被 400 拦下，编辑页无法保存）', async () => {
    mockPrisma.paper.findUnique.mockResolvedValue({ id: 'p1', createdBy: 'u-teacher-1' });
    mockPrisma.paper.update.mockResolvedValue({ id: 'p1' });

    const res = await request(makeApp())
      .put('/api/papers/p1')
      .send({ name: '甲卷', description: null, difficulty: null, passScore: null });

    expect(res.status).toBe(200);
    expect(mockPrisma.paper.update.mock.calls[0][0].data).toMatchObject({
      description: null, difficulty: null, passScore: null,
    });
  });
});

describe('POST /api/papers/:id/duplicate — 复制试卷', () => {
  beforeEach(() => vi.clearAllMocks());

  it('保留题位类型与抽题规则（否则复制出的 rule 题位会变成空题位）', async () => {
    mockPrisma.paper.findUnique.mockResolvedValue({
      id: 'p1',
      name: '甲卷',
      description: null,
      difficulty: null,
      passScore: null,
      totalScore: 20,
      // source/createdBy 对齐真实 Prisma 记录：duplicate 接口会做数据范围校验（本人或官方），
      // fixture 缺字段会被当成"他人的非官方卷"拒掉，测不到本用例关心的 slotType/rule 复制
      source: 'school',
      createdBy: 'u-teacher-1',
      paperQuestions: [
        { questionId: 'q1', sortOrder: 0, score: 10, slotType: 'fixed', rule: null },
        {
          questionId: null, sortOrder: 1, score: 10, slotType: 'rule',
          rule: { capabilityIds: ['cap-1'], type: 'single_choice', difficulty: 'easy' },
        },
      ],
    });
    mockPrisma.paper.create.mockResolvedValue({ id: 'p2' });

    const res = await request(makeApp()).post('/api/papers/p1/duplicate');

    expect(res.status).toBe(201);
    const created = mockPrisma.paper.create.mock.calls[0][0].data.paperQuestions.create;
    expect(created[0]).toMatchObject({ questionId: 'q1', slotType: 'fixed' });
    expect(created[1]).toMatchObject({ questionId: null, slotType: 'rule' });
    expect(created[1].rule).toMatchObject({ type: 'single_choice', difficulty: 'easy' });
  });
});

describe('POST /api/papers/slot-preview — 规则行各难度可用题数', () => {
  beforeEach(() => vi.clearAllMocks());

  it('difficultyCounts 按"分值一致"口径统计（不受规则已选难度影响）', async () => {
    mockPrisma.question.findMany.mockResolvedValue([
      { id: 'q1', title: 'A', type: 'single_choice', difficulty: 'easy', score: 2, schemaRefs: null, capabilityIds: [] },
      { id: 'q2', title: 'B', type: 'single_choice', difficulty: 'easy', score: 2, schemaRefs: null, capabilityIds: [] },
      { id: 'q3', title: 'C', type: 'single_choice', difficulty: 'medium', score: 2, schemaRefs: null, capabilityIds: [] },
      { id: 'q4', title: 'D', type: 'single_choice', difficulty: 'hard', score: 5, schemaRefs: null, capabilityIds: [] },
    ]);

    const res = await request(makeApp())
      .post('/api/papers/slot-preview')
      .send({ rule: { type: 'single_choice', difficulty: 'easy' }, score: 2 });

    expect(res.status).toBe(200);
    expect(res.body.difficultyCounts).toEqual({ easy: 2, medium: 1, hard: 0 });
    expect(res.body.candidateCount).toBe(2);
  });

  it('既有候选池语义不回归：excludedByScore 只统计"难度命中但分值不符"的题', async () => {
    mockPrisma.question.findMany.mockResolvedValue([
      { id: 'q1', title: 'A', type: 'single_choice', difficulty: 'easy', score: 2, schemaRefs: null, capabilityIds: [] },
      { id: 'q2', title: 'B', type: 'single_choice', difficulty: 'easy', score: 3, schemaRefs: null, capabilityIds: [] },
      { id: 'q3', title: 'C', type: 'single_choice', difficulty: 'hard', score: 2, schemaRefs: null, capabilityIds: [] },
    ]);

    const res = await request(makeApp())
      .post('/api/papers/slot-preview')
      .send({ rule: { type: 'single_choice', difficulty: 'easy' }, score: 2 });

    expect(res.status).toBe(200);
    expect(res.body.candidateCount).toBe(1);
    expect(res.body.excludedByScore).toBe(1); // q2；q3 难度不符、不参与该口径
    expect(res.body.warning).toContain('1 道');
  });
});
