import { describe, it, expect } from 'vitest';
import {
  validateProposal,
  ADD_RULE_WHITELIST,
  type Proposal,
  type ValidationContext,
} from '../proposals';

/**
 * 建议卡校验测试 — Phase 2 §4.4
 *
 * 校验规则（结构性，不依赖 Schema；tableName 是否在 Schema 内由 groundProposal 负责）：
 * - add_capability: id 在图谱内、未已选
 * - rewrite_description: 非空且与当前不同
 * - adjust_score / remove_rule: ruleId 在当前 suggestions/rules 内
 * - add_hint: 非空
 * - add_rule: action ∈ 白名单、tableName 非空
 */

const CTX: ValidationContext = {
  selectedCapabilityIds: ['field.single_select'],
  currentDescription: '当前描述',
  ruleIds: ['rule_1', 'rule_2'],
};

describe('ADD_RULE_WHITELIST', () => {
  it('只含可从 Schema 确定性 ground 的字段级/表级 action', () => {
    expect(ADD_RULE_WHITELIST).toContain('check_field');
    expect(ADD_RULE_WHITELIST).toContain('check_field_options');
    expect(ADD_RULE_WHITELIST).toContain('check_table_exists');
    expect(ADD_RULE_WHITELIST).toContain('check_field_count');
    // 视图/表单/记录值规则不在白名单（Phase 3）
    expect(ADD_RULE_WHITELIST).not.toContain('check_view_exists');
    expect(ADD_RULE_WHITELIST).not.toContain('check_form_fields');
    expect(ADD_RULE_WHITELIST).not.toContain('check_record_value');
  });
});

describe('validateProposal — add_capability', () => {
  it('合法且未已选 → ok', () => {
    const p: Proposal = { type: 'add_capability', capabilityId: 'field.multi_select', reason: '补一个多选' };
    expect(validateProposal(p, CTX)).toEqual({ ok: true });
  });
  it('已选 → 拒绝', () => {
    const p: Proposal = { type: 'add_capability', capabilityId: 'field.single_select', reason: '已选的' };
    const r = validateProposal(p, CTX);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toMatch(/已选/);
  });
  it('capabilityId 不存在 → 拒绝', () => {
    const p: Proposal = { type: 'add_capability', capabilityId: 'field.does_not_exist', reason: '瞎编的' };
    const r = validateProposal(p, CTX);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toMatch(/不存在/);
  });
});

describe('validateProposal — rewrite_description', () => {
  it('非空且不同 → ok', () => {
    const p: Proposal = { type: 'rewrite_description', newDescription: '更好的描述', reason: '更地道' };
    expect(validateProposal(p, CTX)).toEqual({ ok: true });
  });
  it('与当前相同 → 拒绝', () => {
    const p: Proposal = { type: 'rewrite_description', newDescription: '当前描述', reason: '没变' };
    expect(validateProposal(p, CTX).ok).toBe(false);
  });
  it('空串 → 拒绝', () => {
    const p: Proposal = { type: 'rewrite_description', newDescription: '   ', reason: '空' };
    expect(validateProposal(p, CTX).ok).toBe(false);
  });
});

describe('validateProposal — adjust_score / remove_rule', () => {
  it('adjust_score 合法 ruleId → ok', () => {
    const p: Proposal = { type: 'adjust_score', ruleId: 'rule_1', newScore: 5, reason: '调分' };
    expect(validateProposal(p, CTX)).toEqual({ ok: true });
  });
  it('adjust_score 不存在的 ruleId → 拒绝', () => {
    const p: Proposal = { type: 'adjust_score', ruleId: 'rule_x', newScore: 5, reason: '不存在' };
    expect(validateProposal(p, CTX).ok).toBe(false);
  });
  it('adjust_score 负分 → 拒绝', () => {
    const p: Proposal = { type: 'adjust_score', ruleId: 'rule_1', newScore: -1, reason: '负分' };
    expect(validateProposal(p, CTX).ok).toBe(false);
  });
  it('remove_rule 合法 → ok', () => {
    const p: Proposal = { type: 'remove_rule', ruleId: 'rule_2', reason: '删' };
    expect(validateProposal(p, CTX)).toEqual({ ok: true });
  });
  it('remove_rule 不存在 → 拒绝', () => {
    const p: Proposal = { type: 'remove_rule', ruleId: 'rule_x', reason: '不存在' };
    expect(validateProposal(p, CTX).ok).toBe(false);
  });
});

describe('validateProposal — add_hint', () => {
  it('非空 → ok', () => {
    const p: Proposal = { type: 'add_hint', hint: '注意选项大小写', reason: '提示' };
    expect(validateProposal(p, CTX)).toEqual({ ok: true });
  });
  it('空串 → 拒绝', () => {
    const p: Proposal = { type: 'add_hint', hint: '  ', reason: '空' };
    expect(validateProposal(p, CTX).ok).toBe(false);
  });
});

describe('validateProposal — add_rule', () => {
  it('白名单内 action + tableName 非空 → ok', () => {
    const p: Proposal = { type: 'add_rule', action: 'check_field_options', tableName: '员工表', fieldName: '状态', reason: '补选项校验' };
    expect(validateProposal(p, CTX)).toEqual({ ok: true });
  });
  it('白名单外 action → 拒绝', () => {
    const p: Proposal = { type: 'add_rule', action: 'check_view_exists', tableName: '员工表', fieldName: '视图1', reason: '视图类不支持' };
    const r = validateProposal(p, CTX);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toMatch(/白名单/);
  });
  it('tableName 空 → 拒绝', () => {
    const p: Proposal = { type: 'add_rule', action: 'check_field', tableName: '  ', fieldName: '姓名', reason: '没表名' };
    expect(validateProposal(p, CTX).ok).toBe(false);
  });
  it('字段级 action 但 fieldName 空 → 拒绝', () => {
    const p: Proposal = { type: 'add_rule', action: 'check_field_options', tableName: '员工表', fieldName: '  ', reason: '没字段名' };
    expect(validateProposal(p, CTX).ok).toBe(false);
  });
  it('表级 action（check_table_exists）无 fieldName → ok', () => {
    const p: Proposal = { type: 'add_rule', action: 'check_table_exists', tableName: '员工表', reason: '验表存在' };
    expect(validateProposal(p, CTX)).toEqual({ ok: true });
  });
});

describe('validateProposal — 未知类型', () => {
  it('未知 type → 拒绝', () => {
    const p = { type: 'bogus', reason: '瞎编' } as unknown as Proposal;
    expect(validateProposal(p, CTX).ok).toBe(false);
  });
});
