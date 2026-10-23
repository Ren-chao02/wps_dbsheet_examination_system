import { describe, it, expect } from 'vitest';
import { repairDifficultyDistribution, computeTargetCounts } from '../paper-difficulty-repair';

const cand = (id: string, difficulty: string) => ({
  id, score: 10, difficulty, schemaRefs: null, answerRules: [],
});
const slot = (slotIndex: number, currentId: string, currentDiff: string, candidates: any[]) =>
  ({ slotIndex, slotScore: 10, currentQuestionId: currentId, currentDifficulty: currentDiff, candidates });

describe('computeTargetCounts', () => {
  it('最大余数法保证 Σtarget = n', () => {
    expect(computeTargetCounts({ easy: 1 / 3, medium: 1 / 3, hard: 1 / 3 }, 8))
      .toEqual({ easy: 3, medium: 3, hard: 2 });
    expect(computeTargetCounts({ easy: 0, medium: 0, hard: 1 }, 2))
      .toEqual({ easy: 0, medium: 0, hard: 2 });
  });
});

describe('repairDifficultyDistribution', () => {
  it('无目标 → 零改动', () => {
    const out = repairDifficultyDistribution([slot(0, 'a', 'easy', [cand('b', 'hard')])], null);
    expect(out.changes).toEqual([]);
    expect(out.targetCounts).toBeNull();
  });

  it('通过换题把分布拉向目标，并记录修复来源/池大小/签名', () => {
    const out = repairDifficultyDistribution([
      slot(0, 'a', 'easy', [cand('a', 'easy'), cand('h1', 'hard')]),
      slot(1, 'b', 'easy', [cand('b', 'easy'), cand('m1', 'medium')]),
      slot(2, 'c', 'easy', [cand('c', 'easy')]),
    ], { easy: 1 / 3, medium: 1 / 3, hard: 1 / 3 });
    expect(out.before).toMatchObject({ easy: 3, medium: 0, hard: 0 });
    expect(out.after).toMatchObject({ easy: 1, medium: 1, hard: 1 });
    expect(out.changes).toHaveLength(2);
    expect(out.changes[0]).toMatchObject({
      slotIndex: 0, from: 'a', to: 'h1', candidates: 2, wantedSignature: '', actualSignature: '',
    });
    expect(out.targetCounts).toEqual({ easy: 1, medium: 1, hard: 1 });
  });

  it('不换成本卷已用的题', () => {
    const out = repairDifficultyDistribution([
      slot(0, 'a', 'easy', [cand('a', 'easy'), cand('h', 'hard')]),
      slot(1, 'h', 'hard', [cand('h', 'hard'), cand('a', 'easy')]),
    ], { easy: 0, medium: 0, hard: 1 });
    // 目标 2 道全 hard：slot0 换 h 会与 slot1 重复；slot1 换 a 会与 slot0 重复 → 不动
    expect(out.changes).toEqual([]);
    expect(out.after).toMatchObject({ easy: 1, hard: 1 });
  });

  it('确定性：同输入两次结果一致，且不改入参', () => {
    const input = [
      slot(0, 'a', 'easy', [cand('a', 'easy'), cand('m', 'medium'), cand('h', 'hard')]),
      slot(1, 'b', 'easy', [cand('b', 'easy'), cand('m2', 'medium')]),
    ];
    const snapshot = JSON.parse(JSON.stringify(input));
    const t = { easy: 0.5, medium: 0.5, hard: 0 };
    expect(repairDifficultyDistribution(input, t)).toEqual(repairDifficultyDistribution(input, t));
    expect(input).toEqual(snapshot);   // 纯函数：入参一个字都不能变
  });
});
