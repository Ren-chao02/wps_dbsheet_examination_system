import { describe, it, expect } from 'vitest';
import { applyRefChipChange, formatRefChip, normalizeQuestionRefs, summarizeRefGroup } from '../question-refs-form';
import type { SchemaRefs } from '../../types';

/** 推导器的真实产物形状（prerequisite-deriver.derivePrerequisites） */
const derivedRefs = (): SchemaRefs => ({
  requires: {
    tables: ['员工信息表'],
    fields: [],
    views: [{ table: '员工信息表', view: '员工总览' }],
  },
  creates: {
    tables: [],
    fields: [{ table: '员工信息表', field: '打卡时间' }],
    views: [],
  },
  tables: ['员工信息表'],
  fields: ['打卡时间'],
});

describe('normalizeQuestionRefs — 保存前归一化', () => {
  it('推导产物原样往返（requires/creates/tables/fields 一个不丢、顺序不变）', () => {
    // 这条是「推导 → 保存 → 重新打开」的客户端一半：归一化不许把 requires/creates 裁成签名用的两串
    expect(normalizeQuestionRefs(derivedRefs())).toEqual(derivedRefs());
  });

  it('空/无契约 → null（不留空对象；旧题没有 requires/creates 也不能炸）', () => {
    expect(normalizeQuestionRefs(null)).toBeNull();
    expect(normalizeQuestionRefs(undefined)).toBeNull();
    expect(normalizeQuestionRefs({})).toBeNull();
    expect(normalizeQuestionRefs({ tables: [], fields: [] })).toBeNull();
    expect(normalizeQuestionRefs({ requires: { tables: [], fields: [], views: [] }, creates: {} })).toBeNull();
  });

  it('旧形状（只有顶层 tables/fields）原样保留 —— 库里既有数据是这一种', () => {
    expect(normalizeQuestionRefs({ tables: ['学生档案'], fields: ['姓名'] }))
      .toEqual({ tables: ['学生档案'], fields: ['姓名'] });
  });

  it('trim + 去重 + 码点排序（多一个空格会让组卷等值校验逐字比对落空）', () => {
    expect(normalizeQuestionRefs({
      requires: { tables: [' 员工信息表 ', '员工信息表', ''], fields: [], views: [] },
      tables: ['统计表', '员工信息表'],
      fields: ['姓名', ' 姓名 '],
    })).toEqual({
      requires: { tables: ['员工信息表'], fields: [], views: [] },
      tables: ['员工信息表', '统计表'],
      fields: ['姓名'],
    });
  });

  it('没有宿主表的字段/视图引用被丢弃（提示条会渲染出没有归属的「含字段：x」）', () => {
    expect(normalizeQuestionRefs({
      requires: {
        tables: [],
        fields: [{ table: '', field: '姓名' }, { table: '员工信息表', field: '  ' }],
        views: [{ table: '员工信息表', view: '员工总览' }],
      },
    })).toEqual({
      requires: { tables: [], fields: [], views: [{ table: '员工信息表', view: '员工总览' }] },
    });
  });
});

describe('applyRefChipChange — tags 标签改动 → 引用数组', () => {
  const oldRefs = [
    { table: '任务表', name: '所属项目' },
    { table: '项目表', name: '项目名' },
  ];

  it('删掉一个标签：其余标签保住各自的宿主表（不搬到同一张表下）', () => {
    expect(applyRefChipChange(oldRefs, ['项目名'], '任务表').next)
      .toEqual([{ table: '项目表', name: '项目名' }]);
  });

  it('新增标签挂到 fallbackTable（第一张「需要」表）', () => {
    expect(applyRefChipChange(oldRefs, ['所属项目', '状态'], '任务表').next)
      .toEqual([{ table: '任务表', name: '所属项目' }, { table: '任务表', name: '状态' }]);
  });

  it('没有表可挂时拒绝新增并点名（挂空表名会写出自相矛盾的提示条）', () => {
    const { next, rejected } = applyRefChipChange([], ['姓名', '  '], '');
    expect(next).toEqual([]);
    expect(rejected).toEqual(['姓名']);
  });

  it('空白标签忽略', () => {
    expect(applyRefChipChange([], ['  '], '员工信息表').next).toEqual([]);
  });
});

describe('formatRefChip / summarizeRefGroup — creates 只读展示', () => {
  it('字段/视图显示成「表.名字」，没有表名时只显示名字', () => {
    expect(formatRefChip('员工信息表', '打卡时间')).toBe('员工信息表.打卡时间');
    expect(formatRefChip('', '打卡时间')).toBe('打卡时间');
  });

  it('摘要按 表 / 字段 / 视图 分组，空组不出现', () => {
    expect(summarizeRefGroup(derivedRefs().creates)).toBe('字段：员工信息表.打卡时间');
    expect(summarizeRefGroup(derivedRefs().requires)).toBe('表：员工信息表；视图：员工信息表.员工总览');
    expect(summarizeRefGroup(null)).toBe('');
    expect(summarizeRefGroup({})).toBe('');
  });
});
