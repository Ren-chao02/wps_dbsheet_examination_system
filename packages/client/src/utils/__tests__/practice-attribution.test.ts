import { describe, it, expect } from 'vitest';
import { buildChainAttribution, questionVerdict } from '../practice-attribution';

const detail = (title: string, errorMessages: string[]) => ({
  questionTitle: title,
  isCorrect: false,
  ruleResults: errorMessages.map(m => ({ action: 'check_field', passed: false, needsReview: false, errorMessage: m })),
});

describe('buildChainAttribution', () => {
  it('多题因同一张表缺失失败 → 折叠成一条链级原因', () => {
    const out = buildChainAttribution([
      detail('创建时间字段', ['未找到表「员工信息表」']),
      detail('创建日期字段', ['未找到表「员工信息表」']),
      detail('设置筛选', ['未找到表「员工信息表」']),
    ]);
    expect(out).toEqual([
      { missingTable: '员工信息表', failedSteps: [1, 2, 3] },
    ]);
  });

  it('只有一题缺表 → 不折叠（单题原因已在题内展示）', () => {
    expect(buildChainAttribution([detail('创建时间字段', ['未找到表「员工信息表」'])])).toEqual([]);
  });

  it('不同表各缺一次 → 各自成立', () => {
    const out = buildChainAttribution([
      detail('A', ['未找到表「员工信息表」']),
      detail('B', ['未找到表「员工信息表」']),
      detail('C', ['未找到表「订单管理表」']),
    ]);
    expect(out).toEqual([{ missingTable: '员工信息表', failedSteps: [1, 2] }]);
  });

  it('无缺表信息 → 空数组（不编造原因）', () => {
    expect(buildChainAttribution([detail('A', ['字段「姓名」格式不符']), detail('B', [])])).toEqual([]);
  });
});

describe('questionVerdict', () => {
  const verdict = (isCorrect: boolean, rules: Array<{ passed: boolean; needsReview?: boolean }>) =>
    questionVerdict({ questionTitle: 'T', isCorrect, ruleResults: rules });

  it('规则全过 → correct', () => {
    expect(verdict(true, [{ passed: true }, { passed: true }])).toBe('correct');
  });

  it('纯 needsReview 失败（passed=false 全因无法自动判定）→ needs_review，不能标「错误」', () => {
    // 复刻判分服务对 check_view_filter 这类规则的产出：passed=false + needsReview=true
    expect(verdict(false, [{ passed: true }, { passed: false, needsReview: true }])).toBe('needs_review');
  });

  it('确实做错（passed=false 且 needsReview=false）→ incorrect', () => {
    expect(verdict(false, [{ passed: false, needsReview: false }, { passed: true }])).toBe('incorrect');
  });

  it('混合（既有做错又有待复核）→ needs_review：题级结论待定，做错的部分由规则明细逐条标出', () => {
    expect(verdict(false, [
      { passed: false, needsReview: false },
      { passed: false, needsReview: true },
    ])).toBe('needs_review');
  });

  it('无规则兜底题（ruleResults 空、isCorrect=false）→ incorrect', () => {
    expect(verdict(false, [])).toBe('incorrect');
  });
});
