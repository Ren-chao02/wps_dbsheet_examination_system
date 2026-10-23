import { describe, it, expect, vi, beforeEach } from 'vitest';

const examQuestionFindMany = vi.fn();
const examFindUnique = vi.fn();
const paperFindUnique = vi.fn();
const questionFindMany = vi.fn();
vi.mock('../../config/prisma', () => ({ prisma: {} }));

import { preflightExamPaper } from '../paper-preflight';

const tx = {
  examQuestion: { findMany: examQuestionFindMany },
  exam: { findUnique: examFindUnique },
  paper: { findUnique: paperFindUnique },
  question: { findMany: questionFindMany },
} as any;

const ruleSlot = (slotIndex: number, rule: any, scoreOverride = 10) =>
  ({ slotIndex, sortOrder: slotIndex, slotType: 'rule', questionId: null, scoreOverride, rule });

// 每个用例只看自己这一次的查询：不重置的话 mockResolvedValueOnce 队列会跨用例泄漏，
// 后续用例会"莫名其妙"拿到上一例的候选。
beforeEach(() => {
  vi.resetAllMocks();
});

describe('preflightExamPaper', () => {
  it('题位为空（有试卷但题目未同步）→ 阻断，不生成 0 题卷子', async () => {
    examQuestionFindMany.mockResolvedValue([]);
    const out = await preflightExamPaper('e-1', tx);
    expect(out.ok).toBe(false);
    expect(out.issues).toHaveLength(1);
    expect(out.issues[0].reason).toContain('没有题位');
    // 没有 rule 题位时不应再加载候选池条件
    expect(examFindUnique).not.toHaveBeenCalled();
  });

  it('固定题位未绑题 → 阻断', async () => {
    examQuestionFindMany.mockResolvedValue([
      { slotIndex: 0, slotType: 'fixed', questionId: null, scoreOverride: null, rule: null },
    ]);
    examFindUnique.mockResolvedValue({ paperId: null });
    const out = await preflightExamPaper('e-1', tx);
    expect(out.ok).toBe(false);
    expect(out.issues[0]).toMatchObject({ slotIndex: 0, reason: '固定题位未绑定题目', candidates: 0 });
    // 没有 rule 题位 → 连候选池条件都不加载（固定题位不碰池）
    expect(examFindUnique).not.toHaveBeenCalled();
  });

  it('抽题题位的 strict 池为空 → 阻断，并区分"结构签名冲突"', async () => {
    examQuestionFindMany.mockResolvedValue([ruleSlot(1, { type: 'comprehensive', difficulty: 'easy', schemaRefs: { tables: ['员工信息表'] } })]);
    examFindUnique.mockResolvedValue({ paperId: 'p-1' });
    paperFindUnique.mockResolvedValue({ createdBy: 'u-1', departmentId: null });
    // strict 空 → 查 relax-schemaRefs；它命中即说明"签名冲突"，relax-difficulty 不再查
    questionFindMany
      .mockResolvedValueOnce([])   // strict
      .mockResolvedValueOnce([{ id: 'q-1', score: 10, difficulty: 'easy', schemaRefs: { tables: ['别的表'] }, answerRules: [] }]); // relax-schemaRefs
    const out = await preflightExamPaper('e-1', tx);
    expect(out.ok).toBe(false);
    expect(out.issues[0]).toMatchObject({ slotIndex: 1, candidates: 0, signatureConflict: true });
    // 前两档都带难度条件；签名冲突时第三档的结果注定被丢弃，不再发查询
    expect(questionFindMany.mock.calls.map(c => c[0].where.difficulty)).toEqual(['easy', 'easy']);
  });

  it('全部满足 → 通过', async () => {
    examQuestionFindMany.mockResolvedValue([ruleSlot(0, { type: 'comprehensive' })]);
    examFindUnique.mockResolvedValue({ paperId: 'p-1' });
    paperFindUnique.mockResolvedValue({ createdBy: 'u-1', departmentId: null });
    questionFindMany.mockResolvedValue([{ id: 'q-1', score: 10, difficulty: 'easy', schemaRefs: null, answerRules: [] }]);
    const out = await preflightExamPaper('e-1', tx);
    expect(out).toEqual({ ok: true, issues: [] });
  });

  it('只放宽难度才有候选 → 阻断，reason 指向难度不足', async () => {
    examQuestionFindMany.mockResolvedValue([ruleSlot(2, { type: 'comprehensive', difficulty: 'easy' })]);
    examFindUnique.mockResolvedValue({ paperId: 'p-1' });
    paperFindUnique.mockResolvedValue({ createdBy: 'u-1', departmentId: null });
    // 默认空兜底：若出现第 4 次查询，说明三档顺序跑偏，别让它悄悄拿到候选
    questionFindMany
      .mockResolvedValue([])
      .mockResolvedValueOnce([])   // strict
      .mockResolvedValueOnce([])   // relax-schemaRefs
      .mockResolvedValueOnce([{ id: 'q-2', score: 10, difficulty: 'hard', schemaRefs: null, answerRules: [] }]); // relax-difficulty
    const out = await preflightExamPaper('e-1', tx);
    expect(out.ok).toBe(false);
    expect(out.issues[0]).toMatchObject({ slotIndex: 2, signatureConflict: false });
    expect(out.issues[0].reason).toContain('难度不足');
    // 三档顺序与生成一致：strict / relax-schemaRefs 带难度条件，relax-difficulty 去掉
    expect(questionFindMany.mock.calls.map(c => c[0].where.difficulty)).toEqual(['easy', 'easy', undefined]);
  });

  it('三档全空 → reason 指向候选池为空（覆盖未上架/不可自动判分等成因）', async () => {
    examQuestionFindMany.mockResolvedValue([ruleSlot(3, { type: 'comprehensive', difficulty: 'easy' })]);
    examFindUnique.mockResolvedValue({ paperId: 'p-1' });
    paperFindUnique.mockResolvedValue({ createdBy: 'u-1', departmentId: null });
    questionFindMany.mockResolvedValue([]);
    const out = await preflightExamPaper('e-1', tx);
    expect(out.ok).toBe(false);
    expect(out.issues[0]).toMatchObject({ slotIndex: 3, signatureConflict: false });
    expect(out.issues[0].reason).toContain('候选池为空');
    expect(questionFindMany).toHaveBeenCalledTimes(3);
  });
});
