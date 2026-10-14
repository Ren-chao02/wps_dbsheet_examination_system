import { describe, it, expect } from 'vitest';
import { buildChainAttribution } from '../practice-attribution';

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
