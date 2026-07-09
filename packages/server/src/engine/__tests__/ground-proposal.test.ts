import { describe, it, expect } from 'vitest';
import { AnswerReverser } from '../answer-reverser';
import type { SchemaResponse } from '../rule-engine';
import { evaluateRules } from '../rule-engine';

/**
 * groundProposal 测试 — Phase 2 §4.5
 *
 * 验证：从真实 Schema 把 add_rule 意图 ground 成参数 100% 真实的 AnswerRule。
 * 关键不变量：LLM 不产参数，参数全部来自 Schema。
 *
 * 反向自测：grounded 规则喂回 rule-engine，用同一份 Schema 判分应得满分（passed）。
 */

const reverser = new AnswerReverser();

function makeSchema(sheets: any[]): SchemaResponse {
  return { result: 0, detail: { sheets } };
}

/** 含单选/文本/数字/关联字段的员工表 */
function employeeSchema(): SchemaResponse {
  return makeSchema([
    {
      id: 1,
      name: '员工表',
      primaryFieldId: 'f1',
      fields: [
        { id: 'f1', name: '姓名', type: 'SingleLineText' },
        {
          id: 'f2',
          name: '状态',
          type: 'SingleSelect',
          items: [
            { value: '在职', color: 1 },
            { value: '离职', color: 2 },
          ],
        },
        { id: 'f3', name: '年龄', type: 'Number', numberFormat: '0.00' },
        { id: 'f4', name: '工号', type: 'SingleLineText', uniqueValue: true },
        { id: 'f5', name: '部门', type: 'SingleLineText', required: true },
        { id: 'f6', name: '主管', type: 'Link', linkSheet: 2 },
      ],
      views: [],
    },
    {
      id: 2,
      name: '部门表',
      primaryFieldId: 'g1',
      fields: [{ id: 'g1', name: '部门名', type: 'SingleLineText' }],
      views: [],
    },
  ]);
}

describe('groundProposal — 字段级 action', () => {
  it('check_field_options → 选项来自 Schema', () => {
    const schema = employeeSchema();
    const r = reverser.groundProposal(
      { action: 'check_field_options', tableName: '员工表', fieldName: '状态' },
      schema,
    );
    expect('rule' in r).toBe(true);
    if (!('rule' in r)) return;
    expect(r.rule.action).toBe('check_field_options');
    expect(r.rule.params.options).toEqual(['在职', '离职']);
    expect(r.rule.params.tableName).toBe('员工表');
    expect(r.rule.params.fieldName).toBe('状态');
    expect(r.rule.score).toBe(0);
  });

  it('check_field → type 为规范类型（single_select）', () => {
    const r = reverser.groundProposal(
      { action: 'check_field', tableName: '员工表', fieldName: '状态' },
      employeeSchema(),
    );
    expect('rule' in r).toBe(true);
    if (!('rule' in r)) return;
    expect(r.rule.params.type).toBe('single_select');
  });

  it('check_field_required → tableName + fieldName', () => {
    const r = reverser.groundProposal(
      { action: 'check_field_required', tableName: '员工表', fieldName: '部门' },
      employeeSchema(),
    );
    expect('rule' in r).toBe(true);
    if (!('rule' in r)) return;
    expect(r.rule.params).toEqual({ tableName: '员工表', fieldName: '部门' });
  });

  it('check_field_unique → tableName + fieldName', () => {
    const r = reverser.groundProposal(
      { action: 'check_field_unique', tableName: '员工表', fieldName: '工号' },
      employeeSchema(),
    );
    expect('rule' in r).toBe(true);
    if (!('rule' in r)) return;
    expect(r.rule.params).toEqual({ tableName: '员工表', fieldName: '工号' });
  });

  it('check_field_format → format 来自 Schema', () => {
    const r = reverser.groundProposal(
      { action: 'check_field_format', tableName: '员工表', fieldName: '年龄' },
      employeeSchema(),
    );
    expect('rule' in r).toBe(true);
    if (!('rule' in r)) return;
    expect(r.rule.params.format).toBe('0.00');
  });

  it('check_field_link_target → targetTable 解析为目标表名', () => {
    const r = reverser.groundProposal(
      { action: 'check_field_link_target', tableName: '员工表', fieldName: '主管' },
      employeeSchema(),
    );
    expect('rule' in r).toBe(true);
    if (!('rule' in r)) return;
    expect(r.rule.params.targetTable).toBe('部门表');
  });
});

describe('groundProposal — 表级 action', () => {
  it('check_table_exists → tableName', () => {
    const r = reverser.groundProposal(
      { action: 'check_table_exists', tableName: '员工表' },
      employeeSchema(),
    );
    expect('rule' in r).toBe(true);
    if (!('rule' in r)) return;
    expect(r.rule.params).toEqual({ tableName: '员工表' });
  });

  it('check_table_name → tableName', () => {
    const r = reverser.groundProposal(
      { action: 'check_table_name', tableName: '员工表' },
      employeeSchema(),
    );
    expect('rule' in r).toBe(true);
    if (!('rule' in r)) return;
    expect(r.rule.params).toEqual({ tableName: '员工表' });
  });

  it('check_table_fields → fields[] 来自 Schema', () => {
    const r = reverser.groundProposal(
      { action: 'check_table_fields', tableName: '员工表' },
      employeeSchema(),
    );
    expect('rule' in r).toBe(true);
    if (!('rule' in r)) return;
    expect(r.rule.params.fields).toEqual(['姓名', '状态', '年龄', '工号', '部门', '主管']);
  });

  it('check_field_count → count 来自 Schema', () => {
    const r = reverser.groundProposal(
      { action: 'check_field_count', tableName: '员工表' },
      employeeSchema(),
    );
    expect('rule' in r).toBe(true);
    if (!('rule' in r)) return;
    expect(r.rule.params.count).toBe(6);
  });
});

describe('groundProposal — 错误情况', () => {
  it('tableName 不存在 → error', () => {
    const r = reverser.groundProposal(
      { action: 'check_table_exists', tableName: '不存在的表' },
      employeeSchema(),
    );
    expect('error' in r).toBe(true);
  });

  it('字段级 action 字段不存在 → error', () => {
    const r = reverser.groundProposal(
      { action: 'check_field', tableName: '员工表', fieldName: '不存在的字段' },
      employeeSchema(),
    );
    expect('error' in r).toBe(true);
  });

  it('check_field_link_target 用在非关联字段 → error', () => {
    const r = reverser.groundProposal(
      { action: 'check_field_link_target', tableName: '员工表', fieldName: '姓名' },
      employeeSchema(),
    );
    expect('error' in r).toBe(true);
  });

  it('check_field_options 用在非选择字段 → error', () => {
    const r = reverser.groundProposal(
      { action: 'check_field_options', tableName: '员工表', fieldName: '姓名' },
      employeeSchema(),
    );
    expect('error' in r).toBe(true);
  });
});

describe('groundProposal — 反向自测：grounded 规则能被 rule-engine 判分通过', () => {
  // 不变量：参数 100% 来自 Schema，用同一份 Schema 自测应得满分
  it('check_field_options 规则判分 passed', () => {
    const schema = employeeSchema();
    const r = reverser.groundProposal(
      { action: 'check_field_options', tableName: '员工表', fieldName: '状态' },
      schema,
    );
    if (!('rule' in r)) throw new Error('should ground');
    const result = evaluateRules(schema, [{ ...r.rule, score: 5 }]);
    expect(result.totalScore).toBe(5);
    expect(result.results[0].passed).toBe(true);
  });

  it('check_field 规则判分 passed', () => {
    const schema = employeeSchema();
    const r = reverser.groundProposal(
      { action: 'check_field', tableName: '员工表', fieldName: '状态' },
      schema,
    );
    if (!('rule' in r)) throw new Error('should ground');
    const result = evaluateRules(schema, [{ ...r.rule, score: 3 }]);
    expect(result.totalScore).toBe(3);
    expect(result.results[0].passed).toBe(true);
  });

  it('check_field_link_target 规则判分 passed', () => {
    const schema = employeeSchema();
    const r = reverser.groundProposal(
      { action: 'check_field_link_target', tableName: '员工表', fieldName: '主管' },
      schema,
    );
    if (!('rule' in r)) throw new Error('should ground');
    const result = evaluateRules(schema, [{ ...r.rule, score: 4 }]);
    expect(result.totalScore).toBe(4);
    expect(result.results[0].passed).toBe(true);
  });

  it('check_table_fields 规则判分 passed', () => {
    const schema = employeeSchema();
    const r = reverser.groundProposal(
      { action: 'check_table_fields', tableName: '员工表' },
      schema,
    );
    if (!('rule' in r)) throw new Error('should ground');
    const result = evaluateRules(schema, [{ ...r.rule, score: 6 }]);
    expect(result.totalScore).toBe(6);
    expect(result.results[0].passed).toBe(true);
  });
});

describe('groundProposal — id 唯一性', () => {
  it('同 action+表+字段不同 index 生成不同 id', () => {
    const schema = employeeSchema();
    const r0 = reverser.groundProposal(
      { action: 'check_field', tableName: '员工表', fieldName: '状态' }, schema, 0);
    const r1 = reverser.groundProposal(
      { action: 'check_field', tableName: '员工表', fieldName: '状态' }, schema, 1);
    if (!('rule' in r0) || !('rule' in r1)) throw new Error('should ground');
    expect(r0.rule.id).not.toBe(r1.rule.id);
    expect(r0.rule.id).toContain('ai_');
  });
});
