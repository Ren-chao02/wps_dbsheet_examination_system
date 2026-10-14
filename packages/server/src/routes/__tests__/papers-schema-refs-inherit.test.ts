/**
 * 组卷断链修复的回归测试：题位 rule.schemaRefs 必须原样落库。
 *
 * 背景：教师以前在组卷页根本无法编辑 schemaRefs（UI 标注「不编辑，仅透传」），
 * 导致 paper-generator 的 strict 等值校验永远拿到空签名、形同虚设。
 *
 * 结论（2026-10-14 实测）：**服务端本就正确，本用例防回归**。
 * PUT /:id/questions 用的是 `rule: (q.rule ?? undefined) as any` 整对象落库，
 * zod 的 slotRuleSchema 也显式声明了 schemaRefs（tables/fields），不存在清洗；
 * 断链只在客户端（规则行没有编辑入口 → paperAssembly 永远拿到空 schemaRefs）。
 * 因此本任务没有改服务端实现，这条用例的作用是锁住"别在后端加字段过滤"。
 *
 * 与简报代码的两处偏差（harness 适配，非实现迁就）：
 * 1. 请求体键名是 `questionIds`（papers.ts 的 paperQuestionSchema），不是 `questions`；
 * 2. mock 必须用 vi.hoisted：`vi.mock` 工厂在文件顶部 import 时就会执行，
 *    普通 `const createMany = vi.fn()` 那时还在 TDZ，会抛 "Cannot access before initialization"。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

vi.mock('../../middleware/auth', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    authenticate: (req: any, _res: any, next: any) => {
      req.user = { id: 't-1', userId: 't-1', username: 't-1', role: 'teacher', permissions: [], departmentId: 'd-1' };
      next();
    },
  };
});

const { mockPrisma, createMany } = vi.hoisted(() => {
  const createMany = vi.fn();
  return {
    createMany,
    mockPrisma: {
      // 所有权检查（createdBy 必须等于请求者）与事务写库
      paper: { findUnique: vi.fn(), update: vi.fn() },
      paperQuestion: { deleteMany: vi.fn(), createMany },
      // 题库可见性查询（P2 数据范围）：rule 题位不带 questionId，走不到这次查询，
      // 但 mock 上留着 —— 以后有人给 rule 题位补 questionId 时用例不会突然报"未 mock 的方法"
      question: { findMany: vi.fn() },
      $transaction: vi.fn(),
    } as any,
  };
});
vi.mock('../../config/prisma', () => ({ prisma: mockPrisma }));

import { paperRouter } from '../papers';

const app = express();
app.use(express.json());
app.use('/api/papers', paperRouter);

/** 合法 uuid：paperQuestionSchema 的 questionId 是 z.string().uuid() */
const Q_FIXED = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  vi.clearAllMocks();
  // 试卷存在且属于请求者，所有权检查通过
  mockPrisma.paper.findUnique.mockResolvedValue({ id: 'p-1', createdBy: 't-1', departmentId: 'd-1', paperQuestions: [] });
  mockPrisma.paper.update.mockResolvedValue({ id: 'p-1', paperQuestions: [] });
  mockPrisma.paperQuestion.deleteMany.mockResolvedValue({ count: 0 });
  mockPrisma.paperQuestion.createMany.mockResolvedValue({ count: 1 });
  mockPrisma.question.findMany.mockResolvedValue([{ id: Q_FIXED }]);
  // 路由把 [deleteMany, createMany, update] 一起丢进 $transaction：按原顺序 resolve，
  // 解构取的第三项（update 结果）就是响应体
  mockPrisma.$transaction.mockImplementation(async (ops: any[]) => Promise.all(ops));
});

describe('PUT /api/papers/:id/questions —— rule 题位的 schemaRefs', () => {
  it('题位声明的 schemaRefs 原样落库（不再被吞掉）', async () => {
    const res = await request(app)
      .put('/api/papers/p-1/questions')
      .send({
        questionIds: [
          {
            slotType: 'rule', sortOrder: 0, score: 10,
            rule: { type: 'add_field', difficulty: 'easy', capabilityIds: [], schemaRefs: { tables: ['员工信息表'], fields: [] } },
          },
        ],
      });

    expect(res.status).toBeLessThan(400);
    const arg = createMany.mock.calls[0][0].data[0];
    expect(arg.rule.schemaRefs).toEqual({ tables: ['员工信息表'], fields: [] });
  });

  it('fixed 题位不写 rule（结构由那道具体的题决定，题位不做声明）', async () => {
    const res = await request(app)
      .put('/api/papers/p-1/questions')
      .send({
        questionIds: [{ questionId: Q_FIXED, slotType: 'fixed', sortOrder: 0, score: 10 }],
      });

    expect(res.status).toBeLessThan(400);
    const arg = createMany.mock.calls[0][0].data[0];
    expect(arg.slotType).toBe('fixed');
    // rule 为 undefined → prisma 写 NULL：fixed 题位不得因为本次改动多出 rule 字段
    expect(arg.rule).toBeUndefined();
  });
});
