/**
 * 绑卷/换卷同步服务：拷贝语义的唯一落点。
 *
 * 这里锁的不是「删了再建」的步骤本身，而是三样随试卷走的东西一旦漏拷会静默退化：
 * 题位（rule 题位丢了就抽不到题）、总分（考试页与成绩换算依赖它）、
 * 难度目标（组卷器按它配比，漏拷 = 每份卷子都不是老师配的难度）。
 */
import { describe, it, expect, vi } from 'vitest';
import { syncPaperIntoExam } from '../paper-exam-sync';

const stubTx = (over: any = {}) => ({
  examQuestion: { deleteMany: vi.fn(), createMany: vi.fn() },
  paper: { findUnique: vi.fn().mockResolvedValue({ difficultyTarget: { easy: 0.3, medium: 0.5, hard: 0.2 } }) },
  paperQuestion: { findMany: vi.fn().mockResolvedValue([
    { questionId: 'q1', sortOrder: 0, score: 10, slotType: 'fixed', rule: null, question: { score: 10 } },
    { questionId: null, sortOrder: 1, score: 5, slotType: 'rule', rule: { type: 'comprehensive' }, question: null },
  ]) },
  exam: { update: vi.fn() },
  ...over,
});

describe('syncPaperIntoExam', () => {
  it('拷题位 + 总分 + 难度目标', async () => {
    const tx = stubTx();
    const out = await syncPaperIntoExam({ examId: 'e-1', paperId: 'p-1', tx: tx as any });
    expect(tx.examQuestion.deleteMany).toHaveBeenCalledWith({ where: { examId: 'e-1' } });
    expect(tx.examQuestion.createMany).toHaveBeenCalledWith({ data: [
      { examId: 'e-1', questionId: 'q1', sortOrder: 0, scoreOverride: 10, slotType: 'fixed', rule: undefined, slotIndex: 0 },
      { examId: 'e-1', questionId: null, sortOrder: 1, scoreOverride: 5, slotType: 'rule', rule: { type: 'comprehensive' }, slotIndex: 1 },
    ] });
    expect(out.totalScore).toBe(15);
    expect(tx.exam.update).toHaveBeenCalledWith({
      where: { id: 'e-1' },
      data: { totalScore: 15, difficultyTarget: { easy: 0.3, medium: 0.5, hard: 0.2 } },
    });
  });

  it('解绑：清空题位、总分 100、目标置空', async () => {
    const tx = stubTx();
    const out = await syncPaperIntoExam({ examId: 'e-1', paperId: null, tx: tx as any });
    expect(tx.examQuestion.deleteMany).toHaveBeenCalled();
    expect(tx.paperQuestion.findMany).not.toHaveBeenCalled();
    expect(out.totalScore).toBe(100);
    expect(tx.exam.update).toHaveBeenCalledWith({
      where: { id: 'e-1' },
      data: { totalScore: 100, difficultyTarget: expect.anything() },
    });
  });
});
