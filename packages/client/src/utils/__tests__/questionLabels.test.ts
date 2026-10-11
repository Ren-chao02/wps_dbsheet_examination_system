/**
 * questionLabels 纯函数测试 — 题型标签、中文序号与答题卡分组
 */
import { describe, it, expect } from 'vitest';
import { QUESTION_TYPE_LABELS, questionTypeLabel, toChineseIndex, groupByQuestionType } from '../questionLabels';

describe('questionTypeLabel', () => {
  it('实操 5 种与客观 3 种都有中文标签（与题目编辑器命名一致）', () => {
    expect(questionTypeLabel('create_table')).toBe('创建数据表');
    expect(questionTypeLabel('comprehensive')).toBe('综合实操');
    expect(questionTypeLabel('single_choice')).toBe('单选题');
    expect(questionTypeLabel('true_false')).toBe('判断题');
    expect(Object.keys(QUESTION_TYPE_LABELS)).toHaveLength(8);
  });

  it('未知题型回退为原始 type，不显示 undefined', () => {
    expect(questionTypeLabel('brand_new_type')).toBe('brand_new_type');
  });
});

describe('toChineseIndex', () => {
  it('1..10 输出中文数字', () => {
    expect(toChineseIndex(1)).toBe('一');
    expect(toChineseIndex(6)).toBe('六');
    expect(toChineseIndex(10)).toBe('十');
  });

  it('11..20 与前缀「十」组合', () => {
    expect(toChineseIndex(11)).toBe('十一');
    expect(toChineseIndex(20)).toBe('二十');
  });

  it('超出范围回退为阿拉伯数字（避免出现奇怪的中文拼接）', () => {
    expect(toChineseIndex(21)).toBe('21');
    expect(toChineseIndex(0)).toBe('0');
  });
});

describe('groupByQuestionType', () => {
  const q = (id: string, type: string, score: number) => ({ id, type, score });

  it('按题型分组且保持题型首次出现顺序', () => {
    const groups = groupByQuestionType([
      q('1', 'create_table', 10),
      q('2', 'single_choice', 2),
      q('3', 'create_table', 5),
      q('4', 'true_false', 3),
    ]);
    expect(groups.map((g) => g.type)).toEqual(['create_table', 'single_choice', 'true_false']);
    expect(groups[0].questions.map((x) => x.id)).toEqual(['1', '3']);
    expect(groups[0].totalScore).toBe(15);
    expect(groups[1].totalScore).toBe(2);
  });

  it('分值口径与卷面介绍一致：score || scoreOverride || 0', () => {
    const groups = groupByQuestionType([
      { id: 'a', type: 'add_field', score: 0, scoreOverride: 8 },
      { id: 'b', type: 'add_field', score: 6, scoreOverride: 99 },
      { id: 'c', type: 'add_field', score: null as unknown as number },
    ]);
    // a: score=0 取 scoreOverride=8；b: score=6 优先；c: 都缺省为 0
    expect(groups[0].totalScore).toBe(14);
  });

  it('type 缺省时归入 comprehensive 组', () => {
    const groups = groupByQuestionType([{ id: 'x', type: '', score: 4 }]);
    expect(groups[0].type).toBe('comprehensive');
    expect(groups[0].label).toBe('综合实操');
  });

  it('空数组返回空分组', () => {
    expect(groupByQuestionType([])).toEqual([]);
  });
});
