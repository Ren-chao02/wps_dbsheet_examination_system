/**
 * 规则引擎测试 —— 判分核心的第一批用例
 *
 * 背景：这个文件此前**一条测试都没有**。用覆盖率实测：29 个规则处理器里
 * 24 个从未被执行过，只有 5 个跑过。而它恰恰是全系统最要紧的一段代码 ——
 * 它判错，学生分数就错。
 *
 * 本批以「已经确认会判错的 bug」为起点（回归测试，防止改回去），
 * 外加几条最容易出错、又直接影响成绩的规则。
 *
 * 约定：这里只测「规则处理器」本身（纯函数，给定 schema + 规则 → 判定结果），
 * 不涉及数据库与网络。适配器对 schema 的归一化另测。
 */
import { describe, it, expect } from 'vitest';
import { evaluateRules, type AnswerRule, type SchemaResponse, type RecordData } from '../rule-engine';

// ───────── 构造测试数据的小工具 ─────────

/** 造一个字段（模拟适配器归一化后的 FieldInfo） */
const F = (name: string, extra: Record<string, any> = {}) => ({ id: name, name, type: 'Text', ...extra });

/** 造一张表 */
const S = (name: string, fields: any[] = [], views: any[] = []) => ({ id: 1, name, fields, views });

const schemaOf = (sheets: any[]): SchemaResponse => ({ result: 0, detail: { sheets } }) as unknown as SchemaResponse;

/** 跑一条规则，返回它的判定结果 */
function run(schema: SchemaResponse, action: string, params: Record<string, any>, records?: RecordData) {
  const rule: AnswerRule = { id: 'r1', action, params, score: 10 };
  return evaluateRules(schema, [rule], records).results[0];
}

// ============================================================
describe('check_field_format —— 回归：学生没配格式不能判通过', () => {
  // 曾经的写法是 `actual.includes(expected) || expected.includes(actual)`，
  // 而空字符串是任何字符串的子串 —— 学生什么都不做也会判通过。
  it('字段没有任何格式配置 → 判不通过', () => {
    const schema = schemaOf([S('员工信息表', [F('入职日期', { type: 'Date', data: {} })])]);
    const r = run(schema, 'check_field_format', {
      tableName: '员工信息表', fieldName: '入职日期', format: 'yyyy-MM-dd',
    });
    expect(r.passed).toBe(false);
    expect(r.needsReview).toBe(false);
  });

  it('规则没写 format（空对空）→ 判不通过', () => {
    const schema = schemaOf([S('员工信息表', [F('入职日期', { type: 'Date', data: {} })])]);
    const r = run(schema, 'check_field_format', {
      tableName: '员工信息表', fieldName: '入职日期', format: '',
    });
    expect(r.passed).toBe(false);
  });

  it('学生配了要求的格式 → 通过', () => {
    const schema = schemaOf([S('员工信息表', [F('入职日期', { type: 'Date', data: { number_format: 'yyyy-MM-dd' } })])]);
    const r = run(schema, 'check_field_format', {
      tableName: '员工信息表', fieldName: '入职日期', format: 'yyyy-MM-dd',
    });
    expect(r.passed).toBe(true);
  });

  it('学生配了别的格式 → 不通过', () => {
    const schema = schemaOf([S('员工信息表', [F('工资', { type: 'Number', data: { number_format: '0.00' } })])]);
    const r = run(schema, 'check_field_format', {
      tableName: '员工信息表', fieldName: '工资', format: 'yyyy-MM-dd',
    });
    expect(r.passed).toBe(false);
  });
});

// ============================================================
describe('check_table_name —— 回归：短表名不能蒙混过关', () => {
  // 曾经的匹配是双向包含，于是 `'员工信息表'.includes('表')` 成立 ——
  // 学生建一张名为「表」的表就能通过检查。
  it('学生建了一张叫「表」的表，不能通过「员工信息表」的检查', () => {
    const schema = schemaOf([S('表')]);
    const r = run(schema, 'check_table_name', { tableName: '员工信息表' });
    expect(r.passed).toBe(false);
  });

  it('表名精确一致 → 通过', () => {
    const r = run(schemaOf([S('员工信息表')]), 'check_table_name', { tableName: '员工信息表' });
    expect(r.passed).toBe(true);
  });

  it('学生表名多带了后缀 → 仍通过（保留模糊容忍）', () => {
    const r = run(schemaOf([S('员工信息表(副本)')]), 'check_table_name', { tableName: '员工信息表' });
    expect(r.passed).toBe(true);
  });

  it('完全无关的表名 → 不通过', () => {
    const r = run(schemaOf([S('学生档案')]), 'check_table_name', { tableName: '员工信息表' });
    expect(r.passed).toBe(false);
  });

  it('规则没配表名（出题错误）→ 转人工复核，不让学生背锅', () => {
    const r = run(schemaOf([S('员工信息表')]), 'check_table_name', {});
    expect(r.passed).toBe(false);
    expect(r.needsReview).toBe(true);
  });
});

// ============================================================
describe('check_field_required', () => {
  it('字段已设为必填 → 通过', () => {
    const schema = schemaOf([S('员工信息表', [F('姓名', { required: true })])]);
    const r = run(schema, 'check_field_required', { tableName: '员工信息表', fieldName: '姓名' });
    expect(r.passed).toBe(true);
  });

  it('字段未设为必填 → 不通过', () => {
    const schema = schemaOf([S('员工信息表', [F('姓名', { required: false })])]);
    const r = run(schema, 'check_field_required', { tableName: '员工信息表', fieldName: '姓名' });
    expect(r.passed).toBe(false);
  });

  it('字段不存在 → 不通过并说明原因', () => {
    const schema = schemaOf([S('员工信息表', [F('姓名')])]);
    const r = run(schema, 'check_field_required', { tableName: '员工信息表', fieldName: '工号' });
    expect(r.passed).toBe(false);
    expect(r.errorMessage).toContain('工号');
  });
});

// ============================================================
describe('记录类规则 —— 取不到数据必须转人工，不能判学生 0 分', () => {
  // 适配器在「表不存在」时是直接 throw 的，所以「表在但取不回来」（权限失效/
  // 限流/网络）与「表压根不存在」必须在数据里区分开：
  // 前者不是学生的操作问题，判 0 分等于冤枉人，而且没人会发现。
  const RECORD_ACTIONS = [
    ['check_record_exists', { tableName: '员工信息表' }],
    ['check_record_value', { tableName: '员工信息表', fieldName: '姓名', value: '张三' }],
    ['check_record_value_exact', { tableName: '员工信息表', fieldName: '姓名', value: '张三' }],
    ['check_record_count', { tableName: '员工信息表', count: 3 }],
  ] as const;

  it.each(RECORD_ACTIONS)('%s：读取失败 → needsReview=true，交人工复核', (action, params) => {
    const records: RecordData = { 员工信息表: { records: [], fetchFailed: true } };
    const schema = schemaOf([S('员工信息表', [F('姓名')])]);
    const r = run(schema, action, params, records);
    expect(r.passed).toBe(false);
    expect(r.needsReview).toBe(true);
    expect(r.errorMessage).toContain('人工复核');
  });

  it('表压根不存在（学生没建）→ 判不通过，且不需要人工复核', () => {
    const schema = schemaOf([S('员工信息表', [F('姓名')])]);
    // recordData 里没有这张表 = 表不存在，被上游跳过了
    const r = run(schema, 'check_record_exists', { tableName: '员工信息表' }, {});
    expect(r.passed).toBe(false);
    expect(r.needsReview).toBe(false);
  });

  it('表在、数据读到了、记录符合要求 → 通过', () => {
    const records: RecordData = {
      员工信息表: { records: [{ id: '1', fields: { 姓名: '张三' } }] },
    };
    const schema = schemaOf([S('员工信息表', [F('姓名')])]);
    const r = run(schema, 'check_record_value', { tableName: '员工信息表', fieldName: '姓名', value: '张三' }, records);
    expect(r.passed).toBe(true);
  });
});

// ============================================================
describe('几条从未被执行过的规则', () => {
  it('check_view_exists：视图在 → 通过；不在 → 不通过并列出已有视图', () => {
    const schema = schemaOf([S('员工信息表', [], [{ id: 'v1', name: '表格视图', type: 'Grid' }])]);
    expect(run(schema, 'check_view_exists', { tableName: '员工信息表', viewName: '表格视图' }).passed).toBe(true);

    const miss = run(schema, 'check_view_exists', { tableName: '员工信息表', viewName: '看板视图' });
    expect(miss.passed).toBe(false);
    expect(miss.actual.availableViews.map((v: any) => v.name)).toEqual(['表格视图']);
  });

  it('check_field_unique：唯一约束配置在 data.unique_value 里也能读到', () => {
    const schema = schemaOf([S('员工信息表', [F('工号', { data: { unique_value: true } })])]);
    expect(run(schema, 'check_field_unique', { tableName: '员工信息表', fieldName: '工号' }).passed).toBe(true);
  });

  it('check_field_default：有默认值 → 通过；没有 → 不通过', () => {
    const withDefault = schemaOf([S('员工信息表', [F('状态', { data: { default_value: '在职' } })])]);
    expect(run(withDefault, 'check_field_default', { tableName: '员工信息表', fieldName: '状态' }).passed).toBe(true);
    expect(run(withDefault, 'check_field_default', { tableName: '员工信息表', fieldName: '状态', defaultValue: '离职' }).passed).toBe(false);

    const noDefault = schemaOf([S('员工信息表', [F('状态')])]);
    expect(run(noDefault, 'check_field_default', { tableName: '员工信息表', fieldName: '状态' }).passed).toBe(false);
  });

  it('check_view_field_hidden：字段被隐藏 → 通过；未被隐藏 → 不通过', () => {
    const hidden = schemaOf([S('员工信息表', [], [{
      id: 'v1', name: '表格视图', type: 'Grid',
      fieldsAttribute: [{ field: '工资', hidden: true }, { field: '姓名', hidden: false }],
    }])]);
    expect(run(hidden, 'check_view_field_hidden', { tableName: '员工信息表', hiddenFields: ['工资'] }).passed).toBe(true);
    expect(run(hidden, 'check_view_field_hidden', { tableName: '员工信息表', hiddenFields: ['姓名'] }).passed).toBe(false);
    expect(run(hidden, 'check_view_field_hidden', { tableName: '员工信息表', visibleFields: ['姓名'] }).passed).toBe(true);
  });

  it('check_field_options：exact 模式要求数量与内容都一致，contains 模式只要求包含', () => {
    const schema = schemaOf([S('员工信息表', [F('状态', { items: [{ value: '在职' }, { value: '离职' }] })])]);

    expect(run(schema, 'check_field_options', { tableName: '员工信息表', fieldName: '状态', options: ['在职', '离职'] }).passed).toBe(true);
    // exact 模式下少一个选项不算通过
    expect(run(schema, 'check_field_options', { tableName: '员工信息表', fieldName: '状态', options: ['在职'] }).passed).toBe(false);
    // contains 模式下可以
    expect(run(schema, 'check_field_options', { tableName: '员工信息表', fieldName: '状态', options: ['在职'], matchMode: 'contains' }).passed).toBe(true);
  });
});

// ============================================================
describe('视图类规则 —— 用真实抓到的接口结构做回归', () => {
  // 下面的字段名和嵌套形状不是编的：2026-10-11 在用户的真实表格上，
  // 让人在 WPS 界面上配好排序/分组/筛选之后，从 /schema/query 的原始响应里抄下来的。
  // 判分引擎必须认得这个形状，否则真实考场上的判定全是错的。
  //
  // ⚠️ 注意这里**没有 filter**：筛选条件在界面上确实配了，接口却一个字都不返回。
  // 这正是 check_view_filter 改成转人工复核的原因。
  const REAL_VIEW = {
    id: 's',
    name: '表格视图',
    type: 'Grid',
    sort: { auto_sort: true, conditions: [{ field: '入职日期', is_ascending: false }] },
    group: { conditions: [{ field: '工龄（年）', is_ascending: true }] },
    fieldsAttribute: [
      { field: '工龄（年）', hidden: false },
      { field: '入职日期', hidden: false },
    ],
  };
  const realSchema = () =>
    schemaOf([S('员工信息表', [F('工龄（年）'), F('入职日期')], [REAL_VIEW])]);

  it('认得真实结构的排序（is_ascending=false 即倒序）', () => {
    const r = run(realSchema(), 'check_view_sort', {
      tableName: '员工信息表', viewName: '表格视图',
      sortBy: [{ field: '入职日期', order: 'desc' }],
    });
    expect(r.passed).toBe(true);
  });

  it('排序方向反了 → 拒绝（不能只认字段名不看方向）', () => {
    const r = run(realSchema(), 'check_view_sort', {
      tableName: '员工信息表', viewName: '表格视图',
      sortBy: [{ field: '入职日期', order: 'asc' }],
    });
    expect(r.passed).toBe(false);
  });

  it('认得真实结构的分组', () => {
    const r = run(realSchema(), 'check_view_group', {
      tableName: '员工信息表', viewName: '表格视图', groupByField: '工龄（年）',
    });
    expect(r.passed).toBe(true);
  });

  it('分组的字段不对 → 拒绝', () => {
    const r = run(realSchema(), 'check_view_group', {
      tableName: '员工信息表', viewName: '表格视图', groupByField: '入职日期',
    });
    expect(r.passed).toBe(false);
  });

  it('筛选：接口不返回筛选数据 → 转人工复核，绝不判学生 0 分', () => {
    const r = run(realSchema(), 'check_view_filter', {
      tableName: '员工信息表', viewName: '表格视图', criteria: [{ field: '入职日期' }],
    });
    expect(r.passed).toBe(false);
    expect(r.needsReview).toBe(true);
    expect(r.errorMessage).toContain('人工复核');
  });

  it('筛选：视图本身不存在 → 仍按「学生没建视图」判不通过，不需要复核', () => {
    const r = run(realSchema(), 'check_view_filter', {
      tableName: '员工信息表', viewName: '看板视图', criteria: [{ field: '入职日期' }],
    });
    expect(r.passed).toBe(false);
    expect(r.needsReview).toBe(false);
  });

  it('筛选：接口若将来开始返回筛选数据，自动判定应当自动恢复', () => {
    // 这条是给未来留的后路：转人工是权宜之计，不该把自动判定的能力永久关掉。
    // 模拟 WPS 补上 filter 之后的行为。
    const futureSchema = schemaOf([
      S('员工信息表', [F('入职日期')], [{
        ...REAL_VIEW,
        filter: { conjunction: 'and', conditions: [{ field: '入职日期', operator: 'isNotEmpty' }] },
      }]),
    ]);
    const r = run(futureSchema, 'check_view_filter', {
      tableName: '员工信息表', viewName: '表格视图', criteria: [{ field: '入职日期' }],
    });
    expect(r.needsReview).toBe(false); // 不再需要人工
    expect(r.passed).toBe(true);       // 而且真的判出来了
  });
});

// ============================================================
describe('未知规则类型', () => {
  it('遇到不认识的 action → 转人工复核，而不是静默判 0 分', () => {
    const r = run(schemaOf([]), 'check_something_new', {});
    expect(r.passed).toBe(false);
    expect(r.needsReview).toBe(true);
  });
});
