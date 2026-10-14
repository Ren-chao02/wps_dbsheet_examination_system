import { describe, it, expect } from 'vitest';
import { buildBackfillPlan } from '../question-refs-backfill';

// description 必须透传：推导器判 check_table_exists 是"真建表 vs 前置检查"要看题面（标题+描述）。
// 现有夹具的标题本就含「创建 + 表名」，故断言不变。
const Q = (id: string, title: string, answerRules: any[], description?: string | null) => ({ id, title, answerRules, description });

describe('buildBackfillPlan', () => {
  it('能推导的题：契约 + 场景 + 顺序一起填好，不进人工清单', () => {
    const plan = buildBackfillPlan([
      Q('q1', '创建员工信息表', [{ id: 'r', action: 'check_table_exists', params: { tableName: '员工信息表' }, score: 100 }]),
      Q('q2', '创建时间字段', [{ id: 'r', action: 'check_field', params: { tableName: '员工信息表', fieldName: '打卡时间' }, score: 100 }]),
    ]);
    expect(plan.autoCount).toBe(2);
    expect(plan.pendingCount).toBe(0);
    expect(plan.scenarios).toEqual([{ key: '员工信息表', questionCount: 2 }]);
    const q2 = plan.entries.find(e => e.id === 'q2')!;
    expect(q2.scenario).toBe('员工信息表');
    expect(q2.scenarioOrder).toBe(2);
    expect(q2.refs.requires.tables).toEqual(['员工信息表']);
    expect(q2.pendingReason).toBeUndefined();
  });

  it('引擎未实现的 action：契约空 + 进人工清单（标出 action 名）', () => {
    const plan = buildBackfillPlan([
      Q('q9', '创建仪表盘并添加柱状图', [{ id: 'r', action: 'verify_dashboard_chart', params: {}, score: 100 }]),
    ]);
    expect(plan.pendingCount).toBe(1);
    const e = plan.entries[0];
    expect(e.refs.tables).toEqual([]);
    expect(e.pendingReason).toContain('verify_dashboard_chart');
  });

  it('answerRules 是脏数据（不是数组）时不炸，进人工清单', () => {
    const plan = buildBackfillPlan([Q('q0', '坏题', null as any)]);
    expect(plan.pendingCount).toBe(1);
    expect(plan.entries[0].pendingReason).toBeTruthy();
  });

  it('跨链题：不给场景，pendingReason 说明原因', () => {
    const plan = buildBackfillPlan([
      Q('q1', '创建员工信息表', [{ id: 'r', action: 'check_table_exists', params: { tableName: '员工信息表' }, score: 100 }]),
      Q('q2', '创建项目表任务表', [
        { id: 'r1', action: 'check_table_exists', params: { tableName: '项目表' }, score: 50 },
        { id: 'r2', action: 'check_table_exists', params: { tableName: '任务表' }, score: 50 },
      ]),
      // 夹具必须真的跨链：同时引用两条链的表、自己不建表。
      // （只引用一条链的表会走 owners.length===1 分支，压根判不到跨链路径）
      Q('q9', '允许多条记录关联', [
        { id: 'r', action: 'check_linked_record', params: { tableName: '项目表', targetTable: '员工信息表' }, score: 100 },
      ]),
    ]);
    const e = plan.entries.find(x => x.id === 'q9')!;
    expect(e.scenario).toBeNull();
    expect(e.scenarioOrder).toBeNull();
    expect(e.pendingReason).toContain('跨链');
    // 契约仍然推导出来（表名按码点序：员 U+5458 < 项 U+9879）
    expect(e.refs.requires.tables).toEqual(['员工信息表', '项目表']);
  });

  it('链顺序沿用归链输出顺序：插入序优先于码点序与 locale 序', () => {
    const plan = buildBackfillPlan([
      Q('q1', '创建安表', [{ id: 'r', action: 'check_table_exists', params: { tableName: '安表' }, score: 100 }]),
      Q('q2', '创建员工信息表', [{ id: 'r', action: 'check_table_exists', params: { tableName: '员工信息表' }, score: 100 }]),
    ]);
    // 插入序 = 教学顺序（谁先出现谁在前）。码点序会给出 ['员工信息表','安表']（员 U+5458 < 安 U+5B89），
    // 中文 locale 序会给出 ['安表','员工信息表']（an < yuan，恰好与插入序相同）——所以任何"加回排序"的实现都会在这里暴露
    expect(plan.scenarios.map(s => s.key)).toEqual(['安表', '员工信息表']);
  });
});
