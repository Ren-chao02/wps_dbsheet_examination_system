import { describe, it, expect, vi } from 'vitest';

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

describe('preflightExamPaper', () => {
  it('固定题位未绑题 → 阻断', async () => {
    examQuestionFindMany.mockResolvedValue([
      { slotIndex: 0, slotType: 'fixed', questionId: null, scoreOverride: null, rule: null },
    ]);
    examFindUnique.mockResolvedValue({ paperId: null });
    const out = await preflightExamPaper('e-1', tx);
    expect(out.ok).toBe(false);
    expect(out.issues[0]).toMatchObject({ slotIndex: 0, reason: '固定题位未绑定题目', candidates: 0 });
  });

  it('抽题题位的 strict 池为空 → 阻断，并区分"结构签名冲突"', async () => {
    examQuestionFindMany.mockResolvedValue([ruleSlot(1, { type: 'comprehensive', schemaRefs: { tables: ['员工信息表'] } })]);
    examFindUnique.mockResolvedValue({ paperId: 'p-1' });
    paperFindUnique.mockResolvedValue({ createdBy: 'u-1', departmentId: null });
    // strict 空 → 会再查 relax-schemaRefs 与 relax-difficulty 以区分成因，三次都要给返回值
    questionFindMany
      .mockResolvedValueOnce([])   // strict
      .mockResolvedValueOnce([{ id: 'q-1', score: 10, difficulty: 'easy', schemaRefs: { tables: ['别的表'] }, answerRules: [] }]) // relax-schemaRefs
      .mockResolvedValueOnce([{ id: 'q-1', score: 10, difficulty: 'easy', schemaRefs: { tables: ['别的表'] }, answerRules: [] }]); // relax-difficulty
    const out = await preflightExamPaper('e-1', tx);
    expect(out.ok).toBe(false);
    expect(out.issues[0]).toMatchObject({ slotIndex: 1, candidates: 0, signatureConflict: true });
  });

  it('全部满足 → 通过', async () => {
    examQuestionFindMany.mockResolvedValue([ruleSlot(0, { type: 'comprehensive' })]);
    examFindUnique.mockResolvedValue({ paperId: 'p-1' });
    paperFindUnique.mockResolvedValue({ createdBy: 'u-1', departmentId: null });
    questionFindMany.mockResolvedValue([{ id: 'q-1', score: 10, difficulty: 'easy', schemaRefs: null, answerRules: [] }]);
    const out = await preflightExamPaper('e-1', tx);
    expect(out).toEqual({ ok: true, issues: [] });
  });
});
