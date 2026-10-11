/**
 * 客观题判分器测试
 *
 * 客观题是"零争议"题型，判分必须完全确定：错就是错、对就是对，
 * 不存在"少选给一半分"这类需要在申诉时解释的灰区。本测试锁死这些口径。
 */
import { describe, it, expect } from 'vitest';
import { gradeObjectiveQuestion, isObjectiveType, normalizeStudentAnswer } from '../objective-grader';

const OPTIONS = [
  { key: 'A', text: '创建数据表' },
  { key: 'B', text: '删除数据表' },
  { key: 'C', text: '重命名数据表' },
];

describe('单选', () => {
  const answer = { options: OPTIONS, correct: ['B'] };

  it('选对得满分', () => {
    const r = gradeObjectiveQuestion('single_choice', answer, 'B', 5);
    expect(r.score).toBe(5);
    expect(r.maxScore).toBe(5);
    expect(r.isCorrect).toBe(true);
  });

  it('选错得 0 分，并在明细里写清应选/实选（便于学生理解与教师复核）', () => {
    const r = gradeObjectiveQuestion('single_choice', answer, 'A', 5);
    expect(r.score).toBe(0);
    expect(r.isCorrect).toBe(false);
    expect(r.ruleResults[0].errorMessage).toContain('应选 B');
    expect(r.ruleResults[0].errorMessage).toContain('实选 A');
  });

  it('未作答与选错要区分（文案不同）', () => {
    const blank = gradeObjectiveQuestion('single_choice', answer, null, 5);
    expect(blank.ruleResults[0].errorMessage).toBe('未作答');
  });

  it('多传了选项按选错处理（单选只能一个答案）', () => {
    const r = gradeObjectiveQuestion('single_choice', answer, ['A', 'B'], 5);
    expect(r.isCorrect).toBe(false);
  });
});

describe('多选', () => {
  const answer = { options: OPTIONS, correct: ['A', 'C'] };

  it('完全一致得满分（与顺序无关）', () => {
    expect(gradeObjectiveQuestion('multiple_choice', answer, ['A', 'C'], 10).isCorrect).toBe(true);
    expect(gradeObjectiveQuestion('multiple_choice', answer, ['C', 'A'], 10).isCorrect).toBe(true);
  });

  it('少选不得分', () => {
    const r = gradeObjectiveQuestion('multiple_choice', answer, ['A'], 10);
    expect(r.score).toBe(0);
    expect(r.isCorrect).toBe(false);
  });

  it('多选不得分', () => {
    expect(gradeObjectiveQuestion('multiple_choice', answer, ['A', 'B', 'C'], 10).isCorrect).toBe(false);
  });

  it('判分口径要写在明细里（"按完全一致计分"）', () => {
    const r = gradeObjectiveQuestion('multiple_choice', answer, ['A'], 10);
    expect(r.ruleResults[0].errorMessage).toContain('不完全一致');
  });

  it('重复提交同一选项不会因为去重而误判', () => {
    expect(gradeObjectiveQuestion('multiple_choice', answer, ['A', 'A', 'C'], 10).isCorrect).toBe(true);
  });
});

describe('判断', () => {
  const answer = { options: [{ key: 'A', text: '正确' }, { key: 'B', text: '错误' }], correct: ['A'] };

  it('选对得满分', () => {
    expect(gradeObjectiveQuestion('true_false', answer, 'A', 4).score).toBe(4);
  });

  it('选错得 0 分', () => {
    expect(gradeObjectiveQuestion('true_false', answer, 'B', 4).score).toBe(0);
  });
});

describe('配置异常与边界', () => {
  it('题目没配正确答案 → 0 分且标记待人工复核（不能让"老师漏配答案"变成学生全 0）', () => {
    const r = gradeObjectiveQuestion('single_choice', { options: OPTIONS, correct: [] }, 'A', 5);
    expect(r.score).toBe(0);
    expect(r.ruleResults[0].needsReview).toBe(true);
    expect(r.ruleResults[0].errorMessage).toContain('未配置正确答案');
  });

  it('答案对象为空 / undefined 同样按未配置处理', () => {
    expect(gradeObjectiveQuestion('single_choice', null, 'A', 5).ruleResults[0].needsReview).toBe(true);
    expect(gradeObjectiveQuestion('single_choice', undefined, 'A', 5).ruleResults[0].needsReview).toBe(true);
  });

  it('分值 0 的题目不会崩', () => {
    const r = gradeObjectiveQuestion('single_choice', { options: OPTIONS, correct: ['A'] }, 'A', 0);
    expect(r.score).toBe(0);
    expect(r.isCorrect).toBe(true);
  });

  it('学生作答为空串 / 空白字符串等同于未作答', () => {
    expect(normalizeStudentAnswer('')).toEqual([]);
    expect(normalizeStudentAnswer('  ')).toEqual([]);
    expect(normalizeStudentAnswer(' A ')).toEqual(['A']);
  });
});

describe('题型判定', () => {
  it('三种客观题走客观题判分，实操题不走', () => {
    expect(isObjectiveType('single_choice')).toBe(true);
    expect(isObjectiveType('multiple_choice')).toBe(true);
    expect(isObjectiveType('true_false')).toBe(true);
    expect(isObjectiveType('comprehensive')).toBe(false);
    expect(isObjectiveType('create_table')).toBe(false);
  });
});
