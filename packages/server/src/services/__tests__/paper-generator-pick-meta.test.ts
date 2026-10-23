import { describe, it, expect, vi } from 'vitest';
import { generateStudentPaper } from '../paper-generator';

function stubTx(over: any = {}) {
  const createMany = vi.fn();
  const tx = {
    examQuestion: { findMany: vi.fn().mockResolvedValue([
      { slotIndex: 0, sortOrder: 0, slotType: 'rule', questionId: null, scoreOverride: 10, rule: { type: 'comprehensive', difficulty: 'easy' } },
      { slotIndex: 1, sortOrder: 1, slotType: 'fixed', questionId: 'q-fixed', scoreOverride: 10, rule: null },
    ]) },
    studentExamQuestion: { count: vi.fn().mockResolvedValue(0), groupBy: vi.fn().mockResolvedValue([]), createMany },
    question: { findMany: vi.fn().mockResolvedValue([
      { id: 'q-1', score: 10, difficulty: 'easy', schemaRefs: null, answerRules: [] },
    ]) },
    exam: { findUnique: vi.fn().mockResolvedValue({ paperId: null }) },
    ...over,
  };
  return { tx, createMany };
}

describe('generateStudentPaper 的 pickMeta', () => {
  it('抽题题位写入命中档位/池大小；固定题位不写', async () => {
    const { tx, createMany } = stubTx();
    await generateStudentPaper('e-1', 's-1', tx as any);
    const rows = createMany.mock.calls[0][0].data;
    const ruleRow = rows.find((r: any) => r.source === 'rule');
    const fixedRow = rows.find((r: any) => r.source === 'fixed');
    expect(ruleRow.pickMeta).toMatchObject({ level: 'strict', candidates: 1 });
    expect(fixedRow.pickMeta).toBeUndefined();
  });

  it('只能放宽难度时，pickMeta.level 记录真实档位', async () => {
    const { tx, createMany } = stubTx();
    // 关键：mock 必须按 where.difficulty 过滤，否则 strict 分支会"看见"这道 hard 题，
    // 测不出档位（listSlotCandidates 依赖 DB 的 where 过滤难度，不在内存里再筛一遍）
    const all = [{ id: 'q-h', score: 10, difficulty: 'hard', schemaRefs: null, answerRules: [] }];
    tx.question.findMany.mockImplementation(async ({ where }: any) =>
      where.difficulty ? all.filter(q => q.difficulty === where.difficulty) : all);
    await generateStudentPaper('e-1', 's-1', tx as any);
    const ruleRow = createMany.mock.calls[0][0].data.find((r: any) => r.source === 'rule');
    expect(ruleRow.pickMeta).toMatchObject({ level: 'relax-difficulty', candidates: 1 });
  });
});
