import { describe, it, expect } from 'vitest';
import { buildRequirementHint, type StudentRequires } from '../question-refs-hint';

describe('buildRequirementHint', () => {
  it('单表有字段：给出表名 + 字段清单 + 「先建它」的指引', () => {
    const hint = buildRequirementHint({
      tables: ['员工信息表'],
      fields: [{ table: '员工信息表', field: '姓名' }, { table: '员工信息表', field: '入职日期' }],
    });
    expect(hint).toBe(
      '本题需要「员工信息表」（含字段：姓名、入职日期）。若你的表格里还没有它，请先在左侧新建这张表并建好这些字段，再完成题目要求。',
    );
  });

  it('单表无字段', () => {
    expect(buildRequirementHint({ tables: ['订单管理表'] })).toBe(
      '本题需要「订单管理表」。若你的表格里还没有它，请先在左侧新建这张表，再完成题目要求。',
    );
  });

  it('多表：表名相邻列出（各带引号，无需顿号），字段按表分组', () => {
    const hint = buildRequirementHint({
      tables: ['任务表', '项目表'],
      fields: [{ table: '任务表', field: '所属项目' }],
    });
    expect(hint).toBe(
      '本题需要「任务表」「项目表」（任务表含字段：所属项目）。若你的表格里还没有它们，请先在左侧新建这些表并建好对应字段，再完成题目要求。',
    );
  });

  it('tables 为空但视图非空 → 从视图的宿主表反推表名，文案不留空指代', () => {
    expect(buildRequirementHint({ views: [{ table: '员工信息表', view: '员工总览' }] })).toBe(
      '本题需要「员工信息表」；另需要视图「员工总览」。若你的表格里还没有它，请先在左侧新建这张表，再完成题目要求。',
    );
  });

  it('空 requires / null → 不显示提示条（返回 null）', () => {
    expect(buildRequirementHint(null)).toBeNull();
    expect(buildRequirementHint(undefined)).toBeNull();
    expect(buildRequirementHint({})).toBeNull();
    expect(buildRequirementHint({ tables: [], fields: [] })).toBeNull();
  });

  it('有视图时并入说明（视图由前序题创建的场景）', () => {
    const hint = buildRequirementHint({
      tables: ['员工信息表'],
      views: [{ table: '员工信息表', view: '员工总览' }],
    });
    expect(hint).toContain('视图「员工总览」');
  });
});
