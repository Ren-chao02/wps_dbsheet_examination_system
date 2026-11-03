/**
 * 试卷读路径的数据范围回归测试（P2）。
 *
 * 锁定三条口径：
 * 1. 列表：教师可读池 = 自己创建 ∪ 本院系 ∪ 校级(departmentId 为空) ∪ 校级池(sharedToSchool)；
 *    范围条件用 AND 组合（search 等业务条件会占用 OR 字段，对象展开合并会互相覆盖）；
 *    count 必须用同一 where，否则分页总数会泄露范围外数量。
 * 2. 详情：池外试卷一律 403（否则拿到 ID 就能绕过列表直读）。
 * 3. slot-preview：候选数按当前请求者的同一可读池统计 —— 预览的池和列表可见性必须一致，
 *    否则教师会看到"列表里没有、题位预览里却算数"的幽灵候选。
 * 4. 创建：默认归属创建者院系（无院系 = 校级 null）。
 * 5. PUT /:id/questions：新挂的题必须在题库读池内，403 时不得 deleteMany
 *    （先删后报错会把原题清光）；「本卷已挂载」的存量跨院系题是显式例外，
 *    否则 P2 之前挂上的题会让整张卷子永远保存不了。
 *
 * 注：scopeCtxOf 从 req.user 取 departmentId（authenticate 的数据库权威值），
 * 因此下面的 authenticate mock 必须在 req.user 上带 departmentId —— 这是 scope 层的一部分。
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
    paper: { findMany: vi.fn(), count: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    paperQuestion: { groupBy: vi.fn(), deleteMany: vi.fn(), createMany: vi.fn() },
    question: { findMany: vi.fn() },
    $transaction: vi.fn(),
  } as any,
}));
vi.mock('../../config/prisma', () => ({ prisma: mockPrisma }));

// previewSlotCandidates 整体 mock：本文件只验证「池条件有没有传下去」这一契约，
// 候选统计逻辑本身仍走真实实现（见 papers.test.ts 的 slot-preview 用例）。
const { mockPreviewSlotCandidates } = vi.hoisted(() => ({
  mockPreviewSlotCandidates: vi.fn(),
}));
vi.mock('../../services/paper-generator', () => ({
  previewSlotCandidates: mockPreviewSlotCandidates,
}));

import { paperRouter } from '../papers';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/papers', paperRouter);
  return app;
}

/** 教师 t-1（院系 d-1）的可读池：自己 ∪ 本院系 ∪ 校级 ∪ 校级池 */
const POOL_OR = [
  { createdBy: 't-1' },
  { departmentId: 'd-1' },
  { departmentId: null },
  { sharedToSchool: true },
];

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.paper.findMany.mockResolvedValue([]);
  mockPrisma.paper.count.mockResolvedValue(0);
  mockPrisma.paper.findUnique.mockResolvedValue(null);
  mockPrisma.paper.create.mockImplementation(async (args: any) => ({ id: 'p-new', ...args.data }));
  mockPrisma.paper.update.mockResolvedValue({ id: 'p-1', paperQuestions: [] });
  mockPrisma.paperQuestion.deleteMany.mockResolvedValue({ count: 0 });
  mockPrisma.paperQuestion.createMany.mockResolvedValue({ count: 0 });
  mockPrisma.question.findMany.mockResolvedValue([]);
  // 路由把 [deleteMany, createMany, update] 一起丢进 $transaction：按原顺序 resolve，
  // 解构取的第三项（update 结果）就是响应体
  mockPrisma.$transaction.mockImplementation(async (ops: any[]) => Promise.all(ops));
  mockPreviewSlotCandidates.mockResolvedValue({
    candidateCount: 0,
    excludedByScore: 0,
    schemaRefsConflict: false,
    difficultyCounts: { easy: 0, medium: 0, hard: 0 },
    candidates: [],
    warning: null,
  });
});

describe('GET /api/papers 列表范围（P2 院系池）', () => {
  it('教师 → AND[0] 为「自己 ∪ 本院系 ∪ 校级 ∪ 校级池」范围条件；count 用同一 where', async () => {
    const res = await request(makeApp())
      .get('/api/papers')
      .set('x-test-role', 'teacher')
      .set('x-test-user', 't-1');

    expect(res.status).toBe(200);
    const arg = mockPrisma.paper.findMany.mock.calls[0][0];
    expect(arg.where.AND[0]).toEqual({ OR: POOL_OR });
    // count 必须用同一 where，否则分页总数会泄露范围外数量
    expect(mockPrisma.paper.count).toHaveBeenCalledWith({ where: arg.where });
  });

  it('search 与范围条件在 AND 里并列（互不覆盖）', async () => {
    const res = await request(makeApp())
      .get('/api/papers?search=甲卷')
      .set('x-test-role', 'teacher')
      .set('x-test-user', 't-1');

    expect(res.status).toBe(200);
    const arg = mockPrisma.paper.findMany.mock.calls[0][0];
    // 范围条件仍在（AND 而非对象展开，search 占用的 name 字段不会把范围覆盖掉）
    expect(arg.where.AND[0]).toEqual({ OR: POOL_OR });
    expect(arg.where.AND).toContainEqual({ name: { contains: '甲卷', mode: 'insensitive' } });
    expect(mockPrisma.paper.count).toHaveBeenCalledWith({ where: arg.where });
  });
});

describe('GET /api/papers/:id 详情范围', () => {
  it('他人院系未上架试卷 → 403，文案指明可见范围', async () => {
    mockPrisma.paper.findUnique.mockResolvedValue({
      createdBy: 't-9',
      departmentId: 'd-9',
      sharedToSchool: false,
    });

    const res = await request(makeApp())
      .get('/api/papers/p-1')
      .set('x-test-role', 'teacher')
      .set('x-test-user', 't-1');

    expect(res.status).toBe(403);
    expect(res.body.message).toBe('该试卷不在你可见的范围内（本院系 / 校级 / 本人）');
  });

  it('校级试卷（departmentId 为空）→ 200', async () => {
    mockPrisma.paper.findUnique.mockResolvedValue({
      id: 'p-2',
      name: '校级卷',
      createdBy: 't-9',
      departmentId: null,
      sharedToSchool: false,
      paperQuestions: [],
    });

    const res = await request(makeApp())
      .get('/api/papers/p-2')
      .set('x-test-role', 'teacher')
      .set('x-test-user', 't-1');

    expect(res.status).toBe(200);
    expect(res.body.id).toBe('p-2');
  });

  it('本院系试卷（非本人创建）→ 200', async () => {
    mockPrisma.paper.findUnique.mockResolvedValue({
      id: 'p-3',
      name: '院系卷',
      createdBy: 't-9',
      departmentId: 'd-1',
      sharedToSchool: false,
      paperQuestions: [],
    });

    const res = await request(makeApp())
      .get('/api/papers/p-3')
      .set('x-test-role', 'teacher')
      .set('x-test-user', 't-1');

    expect(res.status).toBe(200);
  });
});

describe('POST /api/papers 创建默认归属', () => {
  it('默认写入创建者院系', async () => {
    const res = await request(makeApp())
      .post('/api/papers')
      .set('x-test-role', 'teacher')
      .set('x-test-user', 't-1')
      .send({ name: '新卷' });

    expect(res.status).toBe(201);
    const data = mockPrisma.paper.create.mock.calls[0][0].data;
    expect(data.departmentId).toBe('d-1');
  });

  it('创建者无院系 → 写 null（校级）', async () => {
    const res = await request(makeApp())
      .post('/api/papers')
      .set('x-test-role', 'teacher')
      .set('x-test-user', 't-1')
      .set('x-test-dept', 'none')
      .send({ name: '新卷' });

    expect(res.status).toBe(201);
    const data = mockPrisma.paper.create.mock.calls[0][0].data;
    expect(data.departmentId).toBeNull();
  });
});

describe('POST /api/papers/slot-preview 候选池范围', () => {
  it('把当前教师的题目读池作为第三参传给 previewSlotCandidates', async () => {
    const res = await request(makeApp())
      .post('/api/papers/slot-preview')
      .set('x-test-role', 'teacher')
      .set('x-test-user', 't-1')
      .send({ rule: { type: 'single_choice' }, score: 10 });

    expect(res.status).toBe(200);
    expect(mockPreviewSlotCandidates).toHaveBeenCalledTimes(1);
    const [ruleArg, scoreArg, poolArg] = mockPreviewSlotCandidates.mock.calls[0];
    expect(ruleArg).toMatchObject({ type: 'single_choice' });
    expect(scoreArg).toBe(10);
    // 第三参必须是 questionWhere 的结果（{ OR: [...] } 形状），预览池与列表可见性同源
    expect(poolArg).toEqual({ OR: POOL_OR });
  });

  it('admin → 空池条件也照传（生成器按「空 = 不收口」处理）', async () => {
    const res = await request(makeApp())
      .post('/api/papers/slot-preview')
      .set('x-test-role', 'admin')
      .set('x-test-user', 'admin-1')
      .send({ rule: { type: 'single_choice' }, score: 10 });

    expect(res.status).toBe(200);
    expect(mockPreviewSlotCandidates.mock.calls[0][2]).toEqual({});
  });
});

/**
 * 把 where 当查询语义在 fixture 上求值的最小匹配器（只为锁定「已挂载例外」真的生效）：
 * 池分支（含嵌套 OR）逐字段比对，paperQuestions 分支按传入的挂载关系命中。
 * 实现里一旦丢掉挂载例外分支，遗留题在 fixture 上便不匹配任何池分支 → 返回 0 行 → 403，用例变红。
 */
function branchMatches(q: any, branch: any, mounted: Record<string, string[]>): boolean {
  if (branch?.paperQuestions) {
    return (mounted[q.id] ?? []).includes(branch.paperQuestions.some.paperId);
  }
  if (Array.isArray(branch?.OR)) return branch.OR.some((b: any) => branchMatches(q, b, mounted));
  return Object.entries(branch ?? {}).every(([k, v]) => q[k] === v);
}

function stubQuestionFindMany(questions: any[], mounted: Record<string, string[]> = {}) {
  return async ({ where }: any) => {
    const ids: string[] = where.id.in;
    return questions
      .filter((q) => ids.includes(q.id))
      .filter((q) => (where.OR ?? []).some((b: any) => branchMatches(q, b, mounted)))
      .map((q) => ({ id: q.id }));
  };
}

describe('PUT /api/papers/:id/questions 挂题的范围校验', () => {
  // 合法 uuid（zod 的 uuid 校验需要）
  const Q_IN = '22222222-2222-4222-8222-222222222222';
  const Q_OUT = '33333333-3333-4333-8333-333333333333';
  const Q_LEGACY = '55555555-5555-4555-8555-555555555555';

  beforeEach(() => {
    // 试卷存在且属于 t-1，所有权检查通过
    mockPrisma.paper.findUnique.mockResolvedValue({ id: 'p-1', createdBy: 't-1' });
  });

  it('新挂他院系未上架题 → 403 且不 deleteMany；重复/空 questionId 不混进校验', async () => {
    // 两道题里只有一道在池内 —— 用返回条数差判定「有一道不可见」
    mockPrisma.question.findMany.mockResolvedValue([{ id: Q_IN }]);

    const res = await request(makeApp())
      .put('/api/papers/p-1/questions')
      .set('x-test-role', 'teacher')
      .set('x-test-user', 't-1')
      .send({
        questionIds: [
          { questionId: Q_IN, sortOrder: 0 },
          { questionId: Q_OUT, sortOrder: 1 },
          // 重复 ID 与 rule 题位（questionId 为空）都不该混进校验的 in 列表
          { questionId: Q_IN, sortOrder: 2 },
          { questionId: null, sortOrder: 3, slotType: 'rule', rule: { type: 'single_choice' } },
        ],
      });

    expect(res.status).toBe(403);
    expect(res.body.message).toBe('包含不在你可见题库范围内的题目（本院系 / 校级 / 本人）');
    // 先删后报错会把原有题目清光 —— 校验必须在 deleteMany 之前
    expect(mockPrisma.paperQuestion.deleteMany).not.toHaveBeenCalled();
    expect(mockPrisma.paperQuestion.createMany).not.toHaveBeenCalled();
    expect(mockPrisma.paper.update).not.toHaveBeenCalled();
    // 校验查询 = 同一可读池 ∪ 本卷已挂载例外；in 列表已去重、不含 null
    const where = mockPrisma.question.findMany.mock.calls[0][0].where;
    expect(where.id).toEqual({ in: [Q_IN, Q_OUT] });
    expect(where.OR).toEqual([
      { OR: POOL_OR },
      { paperQuestions: { some: { paperId: 'p-1' } } },
    ]);
  });

  it('本卷已挂载的跨院系遗留题 → 200（已挂载例外，卷子保持可编辑）', async () => {
    // 存量遗留题：他院系 d-9 且未上架，唯一放行的理由就是「已挂在本卷上」
    mockPrisma.question.findMany.mockImplementation(
      stubQuestionFindMany(
        [{ id: Q_LEGACY, createdBy: 't-9', departmentId: 'd-9', sharedToSchool: false }],
        { [Q_LEGACY]: ['p-1'] },
      ),
    );

    const res = await request(makeApp())
      .put('/api/papers/p-1/questions')
      .set('x-test-role', 'teacher')
      .set('x-test-user', 't-1')
      .send({
        questionIds: [
          { questionId: Q_LEGACY, sortOrder: 0 },
          { questionId: null, sortOrder: 1, slotType: 'rule', rule: { type: 'single_choice' } },
        ],
      });

    expect(res.status).toBe(200);
    // 校验通过后才执行替换
    expect(mockPrisma.question.findMany.mock.calls[0][0].where.id).toEqual({ in: [Q_LEGACY] });
    expect(mockPrisma.paperQuestion.deleteMany).toHaveBeenCalledWith({ where: { paperId: 'p-1' } });
    expect(mockPrisma.paperQuestion.createMany).toHaveBeenCalledTimes(1);
    expect(res.body.id).toBe('p-1');
  });
});
