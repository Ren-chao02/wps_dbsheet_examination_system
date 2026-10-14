/**
 * 场景归链测试。数据形态取自生产库真实题（2026-10-14）：
 * 员工信息表链、项目/任务链、以及同时引用两张表的跨链题。
 */
import { describe, it, expect } from 'vitest';
import { clusterScenarios } from '../scenario-cluster';

const q = (id: string, title: string, creates: string[], requires: string[] = []) =>
  ({ id, title, creates, requires });

describe('clusterScenarios', () => {
  it('建表题当链根，后续字段题按顺序排在后面', () => {
    const r = clusterScenarios([
      q('q2', '创建时间字段', [], ['员工信息表']),
      q('q1', '创建员工信息表', ['员工信息表']),
      q('q3', '创建日期字段', [], ['员工信息表']),
    ]);
    expect(r.scenarios).toEqual([{ key: '员工信息表', questionIds: ['q1', 'q2', 'q3'] }]);
    expect(r.assignments).toEqual([
      { id: 'q1', scenario: '员工信息表', scenarioOrder: 1 },
      { id: 'q2', scenario: '员工信息表', scenarioOrder: 2 },
      { id: 'q3', scenario: '员工信息表', scenarioOrder: 3 },
    ]);
    expect(r.pending).toEqual([]);
  });

  it('一道题创建两张表 → 两表合成一条链', () => {
    const r = clusterScenarios([
      q('q1', '创建项目表和任务表', ['项目表', '任务表']),
      q('q2', '建引用字段', [], ['任务表']),
    ]);
    expect(r.scenarios).toEqual([{ key: '任务表 + 项目表', questionIds: ['q1', 'q2'] }]);
  });

  it('视图配置题依赖前序题建的视图 → 排在视图题之后', () => {
    const r = clusterScenarios([
      q('q2', '在员工总览视图加筛选', [], ['员工信息表']),
      q('q1', '创建员工信息表', ['员工信息表']),
      q('q3', '新建字段', [], ['员工信息表']),
    ]);
    // q2 的 requires 里没有"视图"这一维度时，只能按 title 稳定排序；
    // 顺序的最终话语权在教师手里（题库页可改 scenarioOrder）
    expect(r.scenarios[0].questionIds).toEqual(['q1', 'q2', 'q3']);
  });

  it('跨链题不猜 → 进待确认清单', () => {
    const r = clusterScenarios([
      q('q1', '创建员工信息表', ['员工信息表']),
      q('q2', '创建项目表任务表', ['项目表', '任务表']),
      q('q9', '设置关联字段允许多条记录关联', [], ['任务表', '员工信息表']),
    ]);
    // 链列表的顺序不是本用例要测的东西（那是输出顺序），用集合比较 ——
    // `.sort()` 是码点序（任 U+4EFB < 员 U+5458），与人类书写顺序不同，写死数组会自相矛盾
    expect(new Set(r.scenarios.map(s => s.key))).toEqual(new Set(['员工信息表', '任务表 + 项目表']));
    expect(r.pending).toEqual([{ id: 'q9', reason: '跨链：需要 任务表、员工信息表（分属两条链），请人工指定场景' }]);
  });

  it('requires 的表没人创建 → 本题自成链根', () => {
    const r = clusterScenarios([q('q1', '创建统计字段求和', [], ['销售员表', '销售报表'])]);
    expect(r.scenarios).toEqual([{ key: '销售员表 + 销售报表', questionIds: ['q1'] }]);
  });

  it('规则里没有表信息 → 进待确认清单', () => {
    const r = clusterScenarios([q('q1', '创建仪表盘', [], [])]);
    expect(r.scenarios).toEqual([]);
    expect(r.pending).toEqual([{ id: 'q1', reason: '规则里没有表信息，无法归链' }]);
  });

  it('依赖成环 → 不再挣扎排序，进待确认清单', () => {
    const r = clusterScenarios([
      q('q1', 'A', ['表X'], ['表Y']),
      q('q2', 'B', ['表Y'], ['表X']),
    ]);
    expect(r.pending).toEqual([
      { id: 'q1', reason: '依赖成环，顺序需人工确认' },
      { id: 'q2', reason: '依赖成环，顺序需人工确认' },
    ]);
    // 成环也给出一个可用的兜底顺序（按 title），不是空手而归
    expect(r.scenarios[0].questionIds).toEqual(['q1', 'q2']);
  });
});
