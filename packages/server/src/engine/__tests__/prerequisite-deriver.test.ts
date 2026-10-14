/**
 * 前置契约推导器测试。
 *
 * 夹具取自生产库的真实规则（2026-10-14 抽查）：建表题、加字段题、视图题、
 * 关联题各一条，外加 16 道「引擎未实现 action」的题各取一个代表。
 */
import { describe, it, expect } from 'vitest';
import { derivePrerequisites } from '../prerequisite-deriver';
import type { AnswerRule } from '../rule-engine';

const rule = (action: string, params: Record<string, any>): AnswerRule => ({ id: 'r1', action, params, score: 10 });

describe('derivePrerequisites', () => {
  it('建表题（真实题：在左侧导航面板中创建新的数据表）→ creates 该表，requires 为空', () => {
    const { refs, unresolved } = derivePrerequisites([rule('check_table_exists', { tableName: '员工信息表' })]);
    expect(refs.creates.tables).toEqual(['员工信息表']);
    expect(refs.requires.tables).toEqual([]);
    expect(refs.tables).toEqual(['员工信息表']);
    expect(unresolved).toEqual([]);
  });

  it('加字段题（真实题：创建时间字段「打卡时间」）→ requires 员工信息表 + creates 该字段', () => {
    const { refs } = derivePrerequisites([
      rule('check_field', { tableName: '员工信息表', fieldName: '打卡时间', fieldType: 'Time' }),
    ]);
    expect(refs.requires.tables).toEqual(['员工信息表']);
    expect(refs.creates.fields).toEqual([{ table: '员工信息表', field: '打卡时间' }]);
    expect(refs.tables).toEqual(['员工信息表']);
    expect(refs.fields).toEqual(['打卡时间']);
  });

  it('同一题里既建表又建字段 → 表算 creates，不再算 requires', () => {
    const { refs } = derivePrerequisites([
      rule('check_table_exists', { tableName: '员工信息表' }),
      rule('check_field', { tableName: '员工信息表', fieldName: '姓名' }),
    ]);
    expect(refs.creates.tables).toEqual(['员工信息表']);
    expect(refs.requires.tables).toEqual([]);
    expect(refs.creates.fields).toEqual([{ table: '员工信息表', field: '姓名' }]);
  });

  it('视图题（真实题：在表格视图中设置筛选条件）→ requires 表与视图，creates 为空', () => {
    const { refs } = derivePrerequisites([
      rule('check_view_filter', { tableName: '员工信息表', viewName: '员工总览', conditions: [] }),
    ]);
    expect(refs.requires.tables).toEqual(['员工信息表']);
    expect(refs.requires.views).toEqual([{ table: '员工信息表', view: '员工总览' }]);
    expect(refs.creates.views).toEqual([]);
  });

  it('同一题里先建视图再配置 → 自己建的视图不算 requires', () => {
    const { refs } = derivePrerequisites([
      rule('check_view_exists', { tableName: '员工信息表', viewName: '员工总览' }),
      rule('check_view_filter', { tableName: '员工信息表', viewName: '员工总览', conditions: [] }),
    ]);
    expect(refs.creates.views).toEqual([{ table: '员工信息表', view: '员工总览' }]);
    expect(refs.requires.views).toEqual([]);
    expect(refs.requires.tables).toEqual(['员工信息表']);
  });

  it('关联题 → 同时 requires 源表与 targetTable', () => {
    const { refs } = derivePrerequisites([
      rule('check_linked_record', { tableName: '任务表', targetTable: '项目表' }),
    ]);
    expect(refs.requires.tables).toEqual(['任务表', '项目表']);
  });

  it('关联字段题（真实题：设置关联字段允许多条记录关联）→ requires 源表与目标表，且 creates 该关联字段', () => {
    const { refs } = derivePrerequisites([
      rule('check_field_link_target', { tableName: '任务表', fieldName: '负责人', targetTable: '员工信息表' }),
    ]);
    expect(refs.requires.tables).toEqual(['任务表', '员工信息表']);
    expect(refs.creates.fields).toEqual([{ table: '任务表', field: '负责人' }]);
  });

  it('表单题 → requires 表 + creates 表单', () => {
    const { refs } = derivePrerequisites([
      rule('check_form_exists', { tableName: '设备巡检表', formName: '巡检登记' }),
    ]);
    expect(refs.requires.tables).toEqual(['设备巡检表']);
    expect(refs.creates.views).toEqual([{ table: '设备巡检表', view: '巡检登记' }]);
  });

  it('引擎未实现的 action（真实题：创建仪表盘并添加柱状图）→ 契约空 + unresolved 标记', () => {
    const { refs, unresolved } = derivePrerequisites([rule('verify_dashboard_chart', { chartType: 'bar' })]);
    expect(refs.requires.tables).toEqual([]);
    expect(refs.creates.tables).toEqual([]);
    expect(refs.tables).toEqual([]);
    expect(unresolved).toEqual(['verify_dashboard_chart']);
  });

  it('缺关键参数的规则不猜 → 进 unresolved', () => {
    const { unresolved } = derivePrerequisites([rule('check_field', { fieldName: '姓名' })]);
    expect(unresolved).toEqual(['check_field']);
  });

  it('多表题（真实题：创建单向关联字段连接两个数据表）→ 两张表都算 creates', () => {
    const { refs } = derivePrerequisites([
      rule('check_table_exists', { tableName: '项目表' }),
      rule('check_table_exists', { tableName: '任务表' }),
      rule('check_field', { tableName: '任务表', fieldName: '所属项目', linkTarget: '项目表' }),
    ]);
    expect(refs.creates.tables).toEqual(['任务表', '项目表']);
    expect(refs.tables).toEqual(['任务表', '项目表']);
    expect(refs.requires.tables).toEqual([]);
  });
});
