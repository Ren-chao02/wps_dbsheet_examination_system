/**
 * 每生卷子生成器测试（抽题组卷的核心保证）
 *
 * 这个功能的成败标准只有两条，本测试就锁这两条：
 *   1. **等值**：不同学生拿到的题可以不同，但同题位的知识点/难度/分值必须一致
 *      —— 否则卷子不等值，同一分数不代表同一水平，成绩不可比、申诉说不清
 *   2. **幂等**：并发/重试不会生成两套卷子（靠唯一约束 + skipDuplicates）
 * 另外覆盖「候选池为空」「题位无题」这类会把考试开废的边界。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    examQuestion: { findMany: vi.fn() },
    studentExamQuestion: { count: vi.fn(), createMany: vi.fn(), findMany: vi.fn(), groupBy: vi.fn() },
    question: { findMany: vi.fn() },
    exam: { findUnique: vi.fn() },
    paper: { findUnique: vi.fn() },
  } as any,
}));
vi.mock('../../config/prisma', () => ({ prisma: mockPrisma }));

import { generateStudentPaper } from '../paper-generator';
import { questionPoolWhereForPaper } from '../data-scope';

/** 构造候选题：能力点 tables.1，难度 easy，10 分 */
function candidate(id: string, overrides: Partial<{ capabilityIds: string[]; difficulty: string; score: number; schemaRefs: any }> = {}) {
  return {
    id,
    score: 10,
    difficulty: 'easy',
    capabilityIds: ['tables.1'],
    schemaRefs: { tables: ['员工信息表'], fields: ['入职日期'] },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.studentExamQuestion.count.mockResolvedValue(0);
  // 默认无人抽过题（各候选题使用次数均为 0 → 走种子哈希选择）
  mockPrisma.studentExamQuestion.groupBy.mockResolvedValue([]);
  // created 取 createMany 的实际插入数：默认按 data.length 返回，与真实 Prisma 一致
  mockPrisma.studentExamQuestion.createMany.mockImplementation(async ({ data }: any) => ({ count: data.length }));
  // 默认「考试未绑试卷」→ 不加候选池条件，既有用例按收口前行为跑
  mockPrisma.exam.findUnique.mockResolvedValue(null);
  mockPrisma.paper.findUnique.mockResolvedValue(null);
});

describe('固定题位', () => {
  it('直接用题位绑定的题目，分值取 scoreOverride', async () => {
    mockPrisma.examQuestion.findMany.mockResolvedValue([
      { slotIndex: 0, sortOrder: 0, slotType: 'fixed', questionId: 'q-fixed', scoreOverride: 8, rule: null, question: { id: 'q-fixed', score: 10, type: 'create_table', difficulty: 'easy', capabilityIds: [], schemaRefs: null, status: 'published' } },
    ]);

    const result = await generateStudentPaper('exam-1', 'stu-1');

    expect(result.created).toBe(1);
    const rows = mockPrisma.studentExamQuestion.createMany.mock.calls[0][0].data;
    expect(rows[0]).toMatchObject({ questionId: 'q-fixed', score: 8, source: 'fixed', slotIndex: 0 });
  });

  it('固定题位没绑题目 → 记入 unfilledSlots 而不是静默丢题', async () => {
    mockPrisma.examQuestion.findMany.mockResolvedValue([
      { slotIndex: 0, sortOrder: 0, slotType: 'fixed', questionId: null, scoreOverride: null, rule: null, question: null },
    ]);

    const result = await generateStudentPaper('exam-1', 'stu-1');
    expect(result.unfilledSlots).toHaveLength(1);
    expect(result.unfilledSlots[0].reason).toContain('未绑定题目');
  });
});

describe('抽题题位', () => {
  const ruleSlot = {
    slotIndex: 0, sortOrder: 0, slotType: 'rule', questionId: null, scoreOverride: 10,
    rule: { capabilityIds: ['tables.1'], difficulty: 'easy', schemaRefs: { tables: ['员工信息表'], fields: ['入职日期'] } },
    question: null,
  };

  it('从候选池抽题，且候选人必须分值一致、schemaRefs 一致', async () => {
    mockPrisma.examQuestion.findMany.mockResolvedValue([ruleSlot]);
    mockPrisma.question.findMany.mockResolvedValue([
      candidate('q-ok-1'),
      candidate('q-ok-2'),
      candidate('q-wrong-score', { score: 20 }),                       // 分值不符 → 排除
      candidate('q-other-table', { schemaRefs: { tables: ['工资表'], fields: [] } }), // 引用结构不一致 → 排除
    ]);

    const result = await generateStudentPaper('exam-1', 'stu-1');

    expect(result.created).toBe(1);
    const picked = mockPrisma.studentExamQuestion.createMany.mock.calls[0][0].data[0];
    expect(['q-ok-1', 'q-ok-2']).toContain(picked.questionId);
    expect(picked.score).toBe(10);
    expect(picked.source).toBe('rule');
  });

  it('两人抽到的题可以不同，但分值/知识点/难度一致（等值替换）', async () => {
    mockPrisma.examQuestion.findMany.mockResolvedValue([ruleSlot]);
    mockPrisma.question.findMany.mockResolvedValue([
      candidate('q-A'), candidate('q-B'), candidate('q-C'), candidate('q-D'),
    ]);

    await generateStudentPaper('exam-1', 'stu-1');
    await generateStudentPaper('exam-1', 'stu-2');

    const pick1 = mockPrisma.studentExamQuestion.createMany.mock.calls[0][0].data[0];
    const pick2 = mockPrisma.studentExamQuestion.createMany.mock.calls[1][0].data[0];

    // 分值必然相同（抽题条件保证），且都来自合规候选池
    expect(pick1.score).toBe(pick2.score);
    expect(['q-A', 'q-B', 'q-C', 'q-D']).toContain(pick1.questionId);
    expect(['q-A', 'q-B', 'q-C', 'q-D']).toContain(pick2.questionId);
  });

  it('同一学生重复调用得到同一道题（种子稳定，便于复现与排查）', async () => {
    mockPrisma.examQuestion.findMany.mockResolvedValue([ruleSlot]);
    mockPrisma.question.findMany.mockResolvedValue([candidate('q-A'), candidate('q-B'), candidate('q-C')]);

    await generateStudentPaper('exam-1', 'stu-1');
    mockPrisma.studentExamQuestion.createMany.mockClear();
    // 模拟"快照丢了重新生成"：抽题结果应与上次一致
    await generateStudentPaper('exam-1', 'stu-1');

    const first = mockPrisma.studentExamQuestion.createMany.mock.calls[0][0].data[0].questionId;

    mockPrisma.studentExamQuestion.createMany.mockClear();
    await generateStudentPaper('exam-1', 'stu-1');
    const second = mockPrisma.studentExamQuestion.createMany.mock.calls[0][0].data[0].questionId;

    expect(second).toBe(first);
  });

  it('严格候选为 0 时逐级放宽（先放宽 schemaRefs，再放宽难度），不会直接判无题', async () => {
    mockPrisma.examQuestion.findMany.mockResolvedValue([ruleSlot]);
    // 只有一道"引用结构不一致但分值相同"的题：严格路径排除，放宽后应命中
    mockPrisma.question.findMany.mockResolvedValue([
      candidate('q-relaxed', { schemaRefs: { tables: ['别的表'], fields: [] } }),
    ]);

    const result = await generateStudentPaper('exam-1', 'stu-1');
    expect(result.created).toBe(1);
    expect(mockPrisma.studentExamQuestion.createMany.mock.calls[0][0].data[0].questionId).toBe('q-relaxed');
  });

  it('候选池彻底为空 → 记入 unfilledSlots 并说明去哪儿检查', async () => {
    mockPrisma.examQuestion.findMany.mockResolvedValue([ruleSlot]);
    mockPrisma.question.findMany.mockResolvedValue([]);

    const result = await generateStudentPaper('exam-1', 'stu-1');
    expect(result.created).toBe(0);
    expect(result.unfilledSlots[0].reason).toContain('候选池为空');
  });

  it('同一份卷子内不会重复用同一道题（多个题位共享候选池）', async () => {
    mockPrisma.examQuestion.findMany.mockResolvedValue([
      { ...ruleSlot, slotIndex: 0 },
      { ...ruleSlot, slotIndex: 1, sortOrder: 1 },
    ]);
    mockPrisma.question.findMany.mockResolvedValue([candidate('q-A'), candidate('q-B')]);

    await generateStudentPaper('exam-1', 'stu-1');
    const rows = mockPrisma.studentExamQuestion.createMany.mock.calls[0][0].data;
    expect(new Set(rows.map((r: any) => r.questionId)).size).toBe(rows.length);
  });

  it('候选池混有引擎判不了的题 → 只跳过坏题，好题照常可抽（不排人工卷）', async () => {
    mockPrisma.examQuestion.findMany.mockResolvedValue([ruleSlot]);
    mockPrisma.question.findMany.mockResolvedValue([
      { ...candidate('q-bad'), answerRules: [{ action: 'verify_dashboard_chart', params: {} }] },
      candidate('q-good'),   // 混池：坏题被跳过，好题照常可抽（防"有坏题即整池丢弃"）
    ]);

    const result = await generateStudentPaper('exam-1', 'stu-1');

    expect(result.created).toBe(1);
    const picked = mockPrisma.studentExamQuestion.createMany.mock.calls[0][0].data[0];
    expect(picked.questionId).toBe('q-good');
  });
});

describe('数据范围 P2：抽题候选池跟随试卷归属', () => {
  const slot = {
    slotIndex: 0, sortOrder: 0, slotType: 'rule', questionId: null, scoreOverride: 10,
    rule: { capabilityIds: ['tables.1'], difficulty: 'easy' },
    question: null,
  };

  it('候选查询把池条件挂在 AND 上：既有过滤不丢，三条放宽路径都生效', async () => {
    mockPrisma.examQuestion.findMany.mockResolvedValue([slot]);
    mockPrisma.exam.findUnique.mockResolvedValue({ paperId: 'p-1' });
    mockPrisma.paper.findUnique.mockResolvedValue({ createdBy: 't-1', departmentId: 'd-1' });
    // 前两次判空、第三次命中：一次生成走满「严格 → 放宽 schemaRefs → 放宽难度」三条路径
    mockPrisma.question.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([candidate('q-pooled')]);

    const result = await generateStudentPaper('exam-1', 'stu-1');

    expect(result.created).toBe(1);
    expect(mockPrisma.studentExamQuestion.createMany.mock.calls[0][0].data[0].questionId).toBe('q-pooled');

    const wantPool = questionPoolWhereForPaper({ createdBy: 't-1', departmentId: 'd-1' });
    expect(mockPrisma.question.findMany).toHaveBeenCalledTimes(3);
    for (const call of mockPrisma.question.findMany.mock.calls) {
      const where = call[0].where;
      expect(where.AND).toEqual([wantPool]); // 池条件（本院系 / 校级 / 作者本人 / 上架）
      // 池条件挂在 AND 上，不覆盖既有的 published / 能力点过滤
      expect(where.status).toBe('published');
      expect(where.capabilityIds).toEqual({ hasEvery: ['tables.1'] });
    }
  });

  it('考试未绑试卷 / 试卷已删 → 不加池条件，行为与收口前一致', async () => {
    mockPrisma.examQuestion.findMany.mockResolvedValue([slot]);
    mockPrisma.question.findMany.mockResolvedValue([candidate('q-any')]);

    // ① 考试未绑试卷：连 paper 都不查（少一次无谓查询），正常生成
    mockPrisma.exam.findUnique.mockResolvedValue({ paperId: null });
    const r1 = await generateStudentPaper('exam-1', 'stu-1');
    expect(r1.created).toBe(1);
    expect(mockPrisma.paper.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.question.findMany.mock.calls[0][0].where.AND).toBeUndefined();

    // ② 试卷已被删（exam.paperId 指向不存在的试卷）：同样不加池条件、不崩
    mockPrisma.question.findMany.mockClear();
    mockPrisma.exam.findUnique.mockResolvedValue({ paperId: 'p-gone' });
    mockPrisma.paper.findUnique.mockResolvedValue(null);
    const r2 = await generateStudentPaper('exam-1', 'stu-2');
    expect(r2.created).toBe(1);
    expect(mockPrisma.paper.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'p-gone' } }));
    expect(mockPrisma.question.findMany.mock.calls[0][0].where.AND).toBeUndefined();
  });

  it('纯固定题位考试不查试卷（不产生无谓查询）', async () => {
    mockPrisma.examQuestion.findMany.mockResolvedValue([
      { slotIndex: 0, sortOrder: 0, slotType: 'fixed', questionId: 'q-1', scoreOverride: null, rule: null, question: { id: 'q-1', score: 5 } },
    ]);

    await generateStudentPaper('exam-1', 'stu-1');
    expect(mockPrisma.exam.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.paper.findUnique).not.toHaveBeenCalled();
  });
});

describe('幂等', () => {
  it('已有快照 → 不重复生成（开考瞬间重试/双标签进入）', async () => {
    mockPrisma.studentExamQuestion.count.mockResolvedValue(10);
    mockPrisma.examQuestion.findMany.mockResolvedValue([{ slotIndex: 0, sortOrder: 0, slotType: 'fixed', questionId: 'q-1', scoreOverride: null, rule: null, question: { id: 'q-1', score: 5 } }]);

    const result = await generateStudentPaper('exam-1', 'stu-1');

    expect(result.created).toBe(0);
    expect(mockPrisma.studentExamQuestion.createMany).not.toHaveBeenCalled();
  });

  it('写入使用 skipDuplicates（并发下靠唯一约束兜底）', async () => {
    mockPrisma.examQuestion.findMany.mockResolvedValue([
      { slotIndex: 0, sortOrder: 0, slotType: 'fixed', questionId: 'q-1', scoreOverride: null, rule: null, question: { id: 'q-1', score: 5 } },
    ]);

    await generateStudentPaper('exam-1', 'stu-1');
    expect(mockPrisma.studentExamQuestion.createMany.mock.calls[0][0].skipDuplicates).toBe(true);
  });

  it('考试没有任何题位 → 返回 0，不报错', async () => {
    mockPrisma.examQuestion.findMany.mockResolvedValue([]);
    const result = await generateStudentPaper('exam-1', 'stu-1');
    expect(result).toMatchObject({ created: 0, total: 0 });
  });
});
