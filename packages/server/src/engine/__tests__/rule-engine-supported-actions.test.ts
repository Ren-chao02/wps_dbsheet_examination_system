/**
 * 规则支持面测试（getSupportedActions / unsupportedRuleActions）
 *
 * 这两个函数是出题/组卷侧判断「这题能不能自动判」的依据：用了未实现 action 的题
 * 判分时永远走 needsReview（转人工），不该被放进考试抽题池。判错的代价是学生
 * 坐到考场才发现题判不了，所以这里把口径钉死。
 *
 * 刻意不写死 action 名单：支持面直接来自 ruleHandlers 的 key，写死会在新增
 * 处理器时让测试过期，进而逼人去改测试而不是相信引擎。
 */
import { describe, it, expect } from 'vitest';
import { getSupportedActions, unsupportedRuleActions } from '../rule-engine';

const rule = (action: string) => ({ id: 'r1', action, params: {}, score: 10 });

describe('getSupportedActions', () => {
  it('返回非空的已注册 action 列表（组卷候选池过滤的数据源）', () => {
    const supported = getSupportedActions();
    expect(supported.length).toBeGreaterThan(0);
    // 抽查两条核心规则：建表检查与字段检查是实操题最常用的规则
    expect(supported).toContain('check_table_exists');
    expect(supported).toContain('check_field');
  });
});

describe('unsupportedRuleActions', () => {
  it('没有规则（空数组 / null / 非数组）→ 空数组（不是错误，只是不在这条判定范围内）', () => {
    expect(unsupportedRuleActions([])).toEqual([]);
    expect(unsupportedRuleActions(null)).toEqual([]);
    expect(unsupportedRuleActions(undefined)).toEqual([]);
    expect(unsupportedRuleActions('not-an-array')).toEqual([]);
  });

  it('引擎认识的 action → 空数组', () => {
    expect(unsupportedRuleActions([rule('check_table_exists'), rule('check_field')])).toEqual([]);
    // 用真实支持面构造：支持面里的每条都必然判为"支持"
    expect(unsupportedRuleActions(getSupportedActions().map(rule))).toEqual([]);
  });

  it('未知 action → 点名（并去重）', () => {
    expect(
      unsupportedRuleActions([rule('verify_dashboard'), rule('check_field'), rule('verify_dashboard')]),
    ).toEqual(['verify_dashboard']);
  });

  it('多条未知 action → 全部点出（教师要知道这题踩了哪几个未实现规则）', () => {
    expect(unsupportedRuleActions([rule('verify_chart'), rule('verify_pivot')])).toEqual([
      'verify_chart',
      'verify_pivot',
    ]);
  });

  it('缺 action / action 为空串的畸形规则不算未知（另有校验负责拦畸形数据）', () => {
    expect(unsupportedRuleActions([{}, { id: 'r2', params: {} }, { action: '' }])).toEqual([]);
  });
});
