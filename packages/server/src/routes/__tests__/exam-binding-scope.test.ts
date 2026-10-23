/**
 * 考试绑定试卷/题目的数据范围测试（P2 · Task 7）。
 *
 * 锁定三处收口：
 * 1. POST /api/exams：绑定的 paperId 必须在自己可见的试卷池内（本人 / 本院系 / 校级 / 校级池），
 *    池外试卷 403 且不创建 —— 否则「拿到 ID 就直连提交」能绕过列表可见性；
 * 2. PUT /api/exams/:id：仅当请求显式携带 paperId 时才校验，普通编辑（不含 paperId）不受影响；
 * 3. PUT /api/exams/:id/questions：挂载的每道题都必须在题库读池内，403 时不得 deleteMany
 *    （先删后报错会把原有题目清光）。
 * 4. POST 创建成功时默认归属创建者院系（无院系 = 校级 null），与题目/试卷创建同口径。
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

// autoEndExpiredExams 会扫全表收卷，测试里直接短路
vi.mock('../../utils/exam-utils', () => ({
  autoEndExpiredExams: vi.fn().mockResolvedValue(undefined),
  finalizeExamSubmissions: vi.fn().mockResolvedValue(undefined),
}));

const { mockPrisma } = vi.hoisted(() => {
  const prismaMock: any = {
    exam: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    examBatch: { findUnique: vi.fn() },
    paper: { findUnique: vi.fn() },
    paperQuestion: { findMany: vi.fn() },
    examQuestion: { deleteMany: vi.fn(), createMany: vi.fn() },
    // 改题后会失效未开考快照（发布后预生成的快照）；本文件用例都是 draft，reschedule 会 skipped
    studentExamQuestion: { deleteMany: vi.fn() },
    question: { findMany: vi.fn() },
  };
  // 换卷/改题在事务内取考试锁：$transaction 把 mock 自身当 tx 传回，$executeRaw 模拟锁执行
  prismaMock.$transaction = vi.fn((fn: any) => fn(prismaMock));
  prismaMock.$executeRaw = vi.fn().mockResolvedValue(1);
  return { mockPrisma: prismaMock };
});
vi.mock('../../config/prisma', () => ({ prisma: mockPrisma }));

import { examRouter } from '../exams';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/exams', examRouter);
  return app;
}

/** 合法 uuid（zod 校验需要），各测试直接复用避免内联散落 */
const PAPER_OUT = '44444444-4444-4444-8444-444444444444'; // 池外试卷
const Q1 = '22222222-2222-4222-8222-222222222222';
const Q2 = '33333333-3333-4333-8333-333333333333';

/** 教师 t-1（院系 d-1）的可读池 */
const POOL_OR = [
  { createdBy: 't-1' },
  { departmentId: 'd-1' },
  { departmentId: null },
  { sharedToSchool: true },
];

/** 无批次的考试必须带起止时间（POST 的既有校验），统一用这个基准时刻 */
const PERIOD = {
  startTime: '2026-11-01T09:00:00.000Z',
  endTime: '2026-11-01T10:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.exam.findUnique.mockResolvedValue(null);
  mockPrisma.paper.findUnique.mockResolvedValue(null);
  mockPrisma.paperQuestion.findMany.mockResolvedValue([]);
  mockPrisma.question.findMany.mockResolvedValue([]);
  mockPrisma.examQuestion.deleteMany.mockResolvedValue({ count: 0 });
  mockPrisma.examQuestion.createMany.mockResolvedValue({ count: 0 });
  mockPrisma.studentExamQuestion.deleteMany.mockResolvedValue({ count: 0 });
  mockPrisma.exam.create.mockImplementation(async (args: any) => ({ id: 'exam-new', ...args.data }));
  mockPrisma.exam.update.mockImplementation(async (args: any) => ({ id: args.where.id, ...args.data }));
});

describe('POST /api/exams 绑定试卷的范围校验', () => {
  it('paperId 指向他院系未上架试卷 → 403，文案指明可见范围，且不创建考试', async () => {
    mockPrisma.paper.findUnique.mockResolvedValue({
      createdBy: 't-9',
      departmentId: 'd-9',
      sharedToSchool: false,
    });

    const res = await request(makeApp())
      .post('/api/exams')
      .set('x-test-role', 'teacher')
      .set('x-test-user', 't-1')
      .send({ title: '新考试', ...PERIOD, paperId: PAPER_OUT });

    expect(res.status).toBe(403);
    expect(res.body.message).toBe('该试卷不在你可见的范围内');
    // 必须在任何写库动作之前拒绝
    expect(mockPrisma.exam.create).not.toHaveBeenCalled();
  });

  it('本院系试卷 → 创建成功（范围校验不误伤池内试卷）', async () => {
    mockPrisma.paper.findUnique.mockResolvedValue({
      createdBy: 't-9',
      departmentId: 'd-1',
      sharedToSchool: false,
    });

    const res = await request(makeApp())
      .post('/api/exams')
      .set('x-test-role', 'teacher')
      .set('x-test-user', 't-1')
      .send({ title: '新考试', ...PERIOD, paperId: PAPER_OUT });

    expect(res.status).toBe(201);
    expect(mockPrisma.paper.findUnique).toHaveBeenCalledWith({
      where: { id: PAPER_OUT },
      // 只取判定所需字段，避免把试卷内容（含答案规则）顺手读出
      select: { createdBy: true, departmentId: true, sharedToSchool: true },
    });
    expect(mockPrisma.exam.create).toHaveBeenCalledTimes(1);
    expect(mockPrisma.exam.create.mock.calls[0][0].data.paperId).toBe(PAPER_OUT);
  });

  it('管理员不受试卷池限制（admin 走全量分支）', async () => {
    mockPrisma.paper.findUnique.mockResolvedValue({
      createdBy: 't-9',
      departmentId: 'd-9',
      sharedToSchool: false,
    });

    const res = await request(makeApp())
      .post('/api/exams')
      .set('x-test-role', 'admin')
      .set('x-test-user', 'admin-1')
      .send({ title: '新考试', ...PERIOD, paperId: PAPER_OUT });

    expect(res.status).toBe(201);
    expect(mockPrisma.exam.create).toHaveBeenCalledTimes(1);
  });
});

describe('POST /api/exams 创建默认归属', () => {
  it('默认写入创建者院系', async () => {
    const res = await request(makeApp())
      .post('/api/exams')
      .set('x-test-role', 'teacher')
      .set('x-test-user', 't-1')
      .send({ title: '新考试', ...PERIOD });

    expect(res.status).toBe(201);
    const data = mockPrisma.exam.create.mock.calls[0][0].data;
    expect(data.departmentId).toBe('d-1');
  });

  it('创建者无院系 → 写 null（校级）', async () => {
    const res = await request(makeApp())
      .post('/api/exams')
      .set('x-test-role', 'teacher')
      .set('x-test-user', 't-1')
      .set('x-test-dept', 'none')
      .send({ title: '新考试', ...PERIOD });

    expect(res.status).toBe(201);
    const data = mockPrisma.exam.create.mock.calls[0][0].data;
    expect(data.departmentId).toBeNull();
  });
});

describe('PUT /api/exams/:id 更换试卷的范围校验', () => {
  beforeEach(() => {
    // 考试存在且属于 t-1（所有权检查通过），草稿状态可编辑
    mockPrisma.exam.findUnique.mockResolvedValue({
      id: 'exam-1',
      createdBy: 't-1',
      status: 'draft',
      paperId: null,
      batchId: null,
      startTime: null,
      endTime: null,
      durationMinutes: 60,
    });
  });

  it('把 paperId 改为池外试卷 → 403 且不更新（不删旧题目）', async () => {
    mockPrisma.paper.findUnique.mockResolvedValue({
      createdBy: 't-9',
      departmentId: 'd-9',
      sharedToSchool: false,
    });

    const res = await request(makeApp())
      .put('/api/exams/exam-1')
      .set('x-test-role', 'teacher')
      .set('x-test-user', 't-1')
      .send({ title: '改标题', paperId: PAPER_OUT });

    expect(res.status).toBe(403);
    expect(mockPrisma.exam.update).not.toHaveBeenCalled();
    // 也不能先把 ExamQuestion 删掉——更换试卷的重新同步必须整个发生在校验之后
    expect(mockPrisma.examQuestion.deleteMany).not.toHaveBeenCalled();
  });

  it('普通编辑（不含 paperId）→ 不触发试卷池校验', async () => {
    const res = await request(makeApp())
      .put('/api/exams/exam-1')
      .set('x-test-role', 'teacher')
      .set('x-test-user', 't-1')
      .send({ title: '只改标题' });

    expect(res.status).toBe(200);
    expect(mockPrisma.paper.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.exam.update).toHaveBeenCalledTimes(1);
  });

  it('paperId 显式置空（解绑）→ 不触发校验（null 无需判定可见性）', async () => {
    const res = await request(makeApp())
      .put('/api/exams/exam-1')
      .set('x-test-role', 'teacher')
      .set('x-test-user', 't-1')
      .send({ title: '解绑试卷', paperId: null });

    expect(res.status).toBe(200);
    expect(mockPrisma.paper.findUnique).not.toHaveBeenCalled();
  });

  it('普通编辑（不含 paperId）且考试已绑卷 → 不重同步、不删题位', async () => {
    mockPrisma.exam.findUnique.mockResolvedValue({
      id: 'exam-1', createdBy: 't-1', status: 'draft',
      paperId: '55555555-5555-4555-8555-555555555555',
      batchId: null, startTime: null, endTime: null, durationMinutes: 60,
    });
    const res = await request(makeApp())
      .put('/api/exams/exam-1')
      .set('x-test-role', 'teacher')
      .set('x-test-user', 't-1')
      .send({ title: '只改标题' });
    expect(res.status).toBe(200);
    expect(mockPrisma.examQuestion.deleteMany).not.toHaveBeenCalled();
    expect(mockPrisma.exam.update).toHaveBeenCalledTimes(1);
  });
});

describe('PUT /api/exams/:id/questions 挂题的范围校验', () => {
  beforeEach(() => {
    mockPrisma.exam.findUnique.mockResolvedValue({
      id: 'exam-1',
      createdBy: 't-1',
      status: 'draft',
    });
  });

  it('questionIds 含一道他院系未上架题 → 403 且不 deleteMany', async () => {
    // 两道题里只有一道在池内 —— 用返回条数差判定「有一道不可见」
    mockPrisma.question.findMany.mockResolvedValue([{ id: Q1 }]);

    const res = await request(makeApp())
      .put('/api/exams/exam-1/questions')
      .set('x-test-role', 'teacher')
      .set('x-test-user', 't-1')
      .send({
        questionIds: [
          { questionId: Q1, sortOrder: 0 },
          { questionId: Q2, sortOrder: 1 },
        ],
      });

    expect(res.status).toBe(403);
    expect(res.body.message).toBe('包含不在你可见题库范围内的题目（本院系 / 校级 / 本人）');
    // 先删后报错会把原有题目清光——校验必须在 deleteMany 之前
    expect(mockPrisma.examQuestion.deleteMany).not.toHaveBeenCalled();
    expect(mockPrisma.examQuestion.createMany).not.toHaveBeenCalled();
    // 可见性查询必须用「同一可读池」条件（AND 组合，与题库列表同源）
    expect(mockPrisma.question.findMany.mock.calls[0][0].where).toEqual({
      AND: [{ id: { in: [Q1, Q2] } }, { OR: POOL_OR }],
    });
  });

  it('全部题目在池内 → 正常替换', async () => {
    mockPrisma.question.findMany.mockResolvedValue([{ id: Q1 }, { id: Q2 }]);

    const res = await request(makeApp())
      .put('/api/exams/exam-1/questions')
      .set('x-test-role', 'teacher')
      .set('x-test-user', 't-1')
      .send({
        questionIds: [
          { questionId: Q1, sortOrder: 0 },
          { questionId: Q2, sortOrder: 1 },
        ],
      });

    expect(res.status).toBe(200);
    expect(mockPrisma.examQuestion.deleteMany).toHaveBeenCalledWith({ where: { examId: 'exam-1' } });
    expect(mockPrisma.examQuestion.createMany).toHaveBeenCalledTimes(1);
  });

  it('空列表（清空题目）→ 不发可见性查询也不报错', async () => {
    const res = await request(makeApp())
      .put('/api/exams/exam-1/questions')
      .set('x-test-role', 'teacher')
      .set('x-test-user', 't-1')
      .send({ questionIds: [] });

    expect(res.status).toBe(200);
    // 清空场景没有 ID 可判，不应发可见性查询（where 里带 AND 的那次）；
    // 注意 handler 后面的算总分仍会用空 in 数组查一次题分，不能用 not.toHaveBeenCalled 一刀切
    const visibilityCalls = mockPrisma.question.findMany.mock.calls.filter(
      (c: any) => c[0]?.where?.AND,
    );
    expect(visibilityCalls).toHaveLength(0);
    expect(mockPrisma.examQuestion.deleteMany).toHaveBeenCalledWith({ where: { examId: 'exam-1' } });
  });
});
