/**
 * 组卷编辑行纯逻辑测试
 *
 * 最关键的用例是「往返转换」：打开已保存试卷 → 编辑行 → 再保存，题位语义必须不变。
 * 这条路径退化会直接损坏教师已有的试卷（掉题、掉规则、掉难度）。
 */
import { describe, it, expect } from 'vitest';
import {
  itemsFromSlots, slotsFromItems, validateEditorItems, analyzeItems, difficultyBreakdown,
  ruleItemTotal, type EditorItem, type RuleEditorItem,
} from '../paperAssembly';
import type { PaperQuestion, Question } from '../../types';

function fixedSlot(questionId: string, score: number, sortOrder: number, type = 'comprehensive', difficulty = 'easy'): PaperQuestion {
  return {
    id: `pq-${sortOrder}`,
    paperId: 'p1',
    questionId,
    sortOrder,
    score,
    slotType: 'fixed',
    rule: null,
    question: { id: questionId, type, difficulty, score, title: `题 ${questionId}` } as Question,
  };
}

function ruleSlot(score: number, sortOrder: number, rule: Record<string, unknown>): PaperQuestion {
  return {
    id: `pq-${sortOrder}`,
    paperId: 'p1',
    questionId: null,
    sortOrder,
    score,
    slotType: 'rule',
    rule: rule as any,
    question: null,
  };
}

describe('itemsFromSlots — 题位聚合为编辑行', () => {
  it('相邻同组规则题位合并成一条规则行，难度计数正确', () => {
    const slots = [
      ruleSlot(2, 0, { capabilityIds: ['cap-a'], type: 'single_choice', difficulty: 'easy' }),
      ruleSlot(2, 1, { capabilityIds: ['cap-a'], type: 'single_choice', difficulty: 'easy' }),
      ruleSlot(2, 2, { capabilityIds: ['cap-a'], type: 'single_choice', difficulty: 'medium' }),
    ];
    const items = itemsFromSlots(slots);
    expect(items).toHaveLength(1);
    const row = items[0] as RuleEditorItem;
    expect(row.counts).toEqual({ easy: 2, medium: 1, hard: 0 });
    expect(ruleItemTotal(row)).toBe(3);
  });

  it('被固定题隔开的同组规则不合并（保留顺序语义）', () => {
    const slots = [
      ruleSlot(2, 0, { capabilityIds: [], type: 'single_choice', difficulty: 'easy' }),
      fixedSlot('q1', 10, 1),
      ruleSlot(2, 2, { capabilityIds: [], type: 'single_choice', difficulty: 'easy' }),
    ];
    const items = itemsFromSlots(slots);
    expect(items.map(i => i.kind)).toEqual(['rule', 'fixed', 'rule']);
  });

  it('未指定难度的旧规则进 noDifficultyCount（不丢数据）', () => {
    const slots = [
      ruleSlot(10, 0, { capabilityIds: ['cap-a'], type: 'comprehensive' }),
      ruleSlot(10, 1, { capabilityIds: ['cap-a'], type: 'comprehensive' }),
    ];
    const items = itemsFromSlots(slots);
    expect(items).toHaveLength(1);
    expect((items[0] as RuleEditorItem).noDifficultyCount).toBe(2);
  });

  it('相邻但分值不同 / 题型不同的规则不合并', () => {
    const slots = [
      ruleSlot(2, 0, { capabilityIds: [], type: 'single_choice', difficulty: 'easy' }),
      ruleSlot(5, 1, { capabilityIds: [], type: 'single_choice', difficulty: 'easy' }),
      ruleSlot(2, 2, { capabilityIds: [], type: 'multiple_choice', difficulty: 'easy' }),
    ];
    expect(itemsFromSlots(slots)).toHaveLength(3);
  });
});

describe('slotsFromItems — 编辑行展开为题位', () => {
  it('往返转换不损坏数据：slots → items → slots 与原始等价', () => {
    const slots = [
      fixedSlot('q1', 10, 0),
      ruleSlot(2, 1, { capabilityIds: ['cap-a', 'cap-b'], type: 'single_choice', difficulty: 'easy' }),
      ruleSlot(2, 2, { capabilityIds: ['cap-a', 'cap-b'], type: 'single_choice', difficulty: 'hard' }),
      fixedSlot('q2', 5, 3, 'add_field', 'medium'),
      ruleSlot(10, 4, { capabilityIds: ['cap-c'], type: 'comprehensive' }),
    ];
    // 保持 sortOrder 与题位顺序一致（服务端以数组顺序为准，测试里对齐原始编号）
    const roundtrip = slotsFromItems(itemsFromSlots(slots));
    expect(roundtrip.map(s => ({ ...s, sortOrder: 0 }))).toEqual(
      slots.map(s => ({
        questionId: s.questionId,
        sortOrder: 0,
        score: s.score,
        slotType: s.slotType,
        rule: s.slotType === 'rule' ? s.rule : undefined,
      })),
    );
  });

  it('展开顺序为 简单→中等→困难→旧规则，且 sortOrder 连续', () => {
    const items: EditorItem[] = [{
      kind: 'rule',
      key: 'r1',
      ruleType: 'single_choice',
      capabilityIds: ['cap-a'],
      score: 2,
      counts: { easy: 1, medium: 2, hard: 0 },
      noDifficultyCount: 1,
    }];
    const slots = slotsFromItems(items);
    expect(slots.map(s => [s.sortOrder, (s.rule as any).difficulty ?? 'none'])).toEqual([
      [0, 'easy'], [1, 'medium'], [2, 'medium'], [3, 'none'],
    ]);
  });

  it('schemaRefs 透传保留（UI 不编辑但不能丢）', () => {
    const slots = [
      ruleSlot(10, 0, { capabilityIds: [], type: 'comprehensive', difficulty: 'easy', schemaRefs: { tables: ['员工信息表'] } }),
    ];
    const roundtrip = slotsFromItems(itemsFromSlots(slots));
    expect((roundtrip[0].rule as any).schemaRefs).toEqual({ tables: ['员工信息表'] });
  });

  it('教师声明的 schemaRefs 往返不丢（items → questions → items，覆盖编辑路径）', () => {
    // 「打开旧卷 → 在组卷页声明结构 → 保存 → 再打开」这条路径必须原样回来：
    // 声明是抽题等值校验的唯一依据，丢一次就等于静默关掉校验
    const items: EditorItem[] = [{
      kind: 'rule',
      key: 'r1',
      ruleType: 'comprehensive',
      capabilityIds: ['cap-a'],
      score: 10,
      counts: { easy: 1, medium: 0, hard: 0 },
      noDifficultyCount: 0,
      schemaRefs: { tables: ['员工信息表'], fields: ['入职日期', '部门'] },
    }];
    const slots = slotsFromItems(items);
    const back = itemsFromSlots(slots as unknown as PaperQuestion[]);
    expect(back).toHaveLength(1);
    expect((back[0] as RuleEditorItem).schemaRefs).toEqual({ tables: ['员工信息表'], fields: ['入职日期', '部门'] });
  });

  it('相邻但 schemaRefs 不同的规则题位不合并（分组不能把两种结构声明并成一行）', () => {
    const slots = [
      ruleSlot(10, 0, { capabilityIds: [], type: 'comprehensive', difficulty: 'easy', schemaRefs: { tables: ['员工信息表'] } }),
      ruleSlot(10, 1, { capabilityIds: [], type: 'comprehensive', difficulty: 'easy', schemaRefs: { tables: ['订单表'] } }),
      // 未声明结构（null）与已声明也不合并：一个是"不校验"，一个是"必须同一结构"
      ruleSlot(10, 2, { capabilityIds: [], type: 'comprehensive', difficulty: 'easy' }),
    ];
    const items = itemsFromSlots(slots);
    expect(items).toHaveLength(3);
    expect((items[0] as RuleEditorItem).schemaRefs).toEqual({ tables: ['员工信息表'] });
    expect((items[0] as RuleEditorItem).counts.easy).toBe(1);
  });
});

describe('validateEditorItems — 保存前校验', () => {
  const ruleItem = (over: Partial<RuleEditorItem> = {}): RuleEditorItem => ({
    kind: 'rule', key: 'r', ruleType: 'single_choice', capabilityIds: [], score: 2,
    counts: { easy: 1, medium: 0, hard: 0 }, noDifficultyCount: 0, ...over,
  });

  it('空规则行报错', () => {
    const errors = validateEditorItems([ruleItem({ counts: { easy: 0, medium: 0, hard: 0 } })]);
    expect(errors[0]).toContain('还没有设置抽题数量');
  });

  it('抽题数量超过可用题数报错', () => {
    const errors = validateEditorItems([ruleItem({ counts: { easy: 3, medium: 0, hard: 0 }, availability: { easy: 2, medium: 1, hard: 0 } })]);
    expect(errors[0]).toContain('简单题要抽 3 道');
    expect(errors[0]).toContain('只有 2 道可用');
  });

  it('可用题数未知（未查询）时不误报', () => {
    expect(validateEditorItems([ruleItem()])).toEqual([]);
  });

  it('固定题未指定题目报错', () => {
    const errors = validateEditorItems([{ kind: 'fixed', key: 'f', questionId: '', question: null, score: 10 }]);
    expect(errors[0]).toContain('固定题尚未指定题目');
  });
});

describe('analyzeItems — 试卷分析', () => {
  it('按题型统计题数/分值/占比与题号', () => {
    const items: EditorItem[] = [
      { kind: 'fixed', key: 'f1', questionId: 'q1', question: { type: 'comprehensive' } as Question, score: 10 },
      { kind: 'fixed', key: 'f2', questionId: 'q2', question: { type: 'single_choice' } as Question, score: 2 },
      {
        kind: 'rule', key: 'r1', ruleType: 'single_choice', capabilityIds: [], score: 2,
        counts: { easy: 1, medium: 1, hard: 0 }, noDifficultyCount: 0,
      },
    ];
    const result = analyzeItems(items);
    expect(result.totalQuestions).toBe(4);
    expect(result.totalScore).toBe(16);
    expect(result.rows.map(r => [r.key, r.count, r.score, r.indexes])).toEqual([
      ['fixed:comprehensive', 1, 10, [1]],
      ['fixed:single_choice', 1, 2, [2]],
      ['rule:single_choice', 2, 4, [3, 4]],
    ]);
    expect(result.rows[0].countPct).toBe(25);
    expect(result.rows[0].scorePct).toBe(63); // 10/16 四舍五入
  });

  it('空试卷不除零', () => {
    expect(analyzeItems([])).toEqual({ totalQuestions: 0, totalScore: 0, rows: [] });
  });
});

describe('difficultyBreakdown — 已选清单难度分布', () => {
  it('固定题按题目难度、规则行按抽题数量统计（旧规则不计入）', () => {
    const items: EditorItem[] = [
      { kind: 'fixed', key: 'f1', questionId: 'q1', question: { difficulty: 'easy' } as Question, score: 10 },
      {
        kind: 'rule', key: 'r1', ruleType: 'single_choice', capabilityIds: [], score: 2,
        counts: { easy: 2, medium: 1, hard: 0 }, noDifficultyCount: 1,
      },
    ];
    expect(difficultyBreakdown(items)).toEqual({ easy: 3, medium: 1, hard: 0 });
  });
});
