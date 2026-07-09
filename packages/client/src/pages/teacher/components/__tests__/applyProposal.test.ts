/**
 * applyProposal 纯逻辑测试 — Phase 2 §5.2
 *
 * applyProposal 接收当前题目状态 + 一条建议卡，返回新状态（部分字段）。
 * 纯函数，不依赖 React，便于覆盖所有 6 种 Proposal 类型的边界。
 *
 * @see docs/superpowers/specs/2026-07-08-phase2-ai-coaching-design.md §5.2
 */
import { describe, it, expect } from 'vitest';
import { applyProposal, type QuestionStateForApply } from '../applyProposal';
import type { Proposal, AnswerRule, RuleSuggestion } from '../../../../types';

function makeState(overrides: Partial<QuestionStateForApply> = {}): QuestionStateForApply {
  return {
    selectedCapabilityIds: ['table.create'],
    suggestions: [],
    rules: [],
    description: '原始描述',
    hints: '',
    ...overrides,
  };
}

function makeRule(id: string, score: number = 5): AnswerRule {
  return { id, action: 'check_field', params: { tableName: 'T', fieldName: 'F' }, score };
}

function makeSuggestion(rule: AnswerRule): RuleSuggestion {
  return {
    rule,
    source: { sheetName: 'T', sheetId: 0, fieldName: 'F', capabilityId: '' },
    editable: false,
    selected: true,
    missingParams: [],
  };
}

describe('applyProposal', () => {
  // ============================================================
  // add_capability
  // ============================================================
  it('add_capability：新增到 selectedCapabilityIds', () => {
    const result = applyProposal(
      makeState(),
      { type: 'add_capability', capabilityId: 'field.text', reason: '补一个文本字段' },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.newState.selectedCapabilityIds).toEqual(['table.create', 'field.text']);
    }
  });

  it('add_capability：已选 → ok:false', () => {
    const result = applyProposal(
      makeState(),
      { type: 'add_capability', capabilityId: 'table.create', reason: '重复' },
    );
    expect(result.ok).toBe(false);
  });

  // ============================================================
  // rewrite_description
  // ============================================================
  it('rewrite_description：返回新描述', () => {
    const result = applyProposal(
      makeState({ description: '旧的' }),
      { type: 'rewrite_description', newDescription: '新的描述', reason: '更清晰' },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.newState.description).toBe('新的描述');
    }
  });

  // ============================================================
  // add_hint
  // ============================================================
  it('add_hint：追加到已有 hints（换行分隔）', () => {
    const result = applyProposal(
      makeState({ hints: '提示一' }),
      { type: 'add_hint', hint: '提示二', reason: '' },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.newState.hints).toBe('提示一\n提示二');
    }
  });

  it('add_hint：空 hints 不加前导换行', () => {
    const result = applyProposal(
      makeState({ hints: '' }),
      { type: 'add_hint', hint: '第一条提示', reason: '' },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.newState.hints).toBe('第一条提示');
    }
  });

  // ============================================================
  // adjust_score
  // ============================================================
  it('adjust_score：在 suggestions 中找到并更新分值', () => {
    const rule = makeRule('r1', 5);
    const state = makeState({ suggestions: [makeSuggestion(rule)] });
    const result = applyProposal(state, {
      type: 'adjust_score', ruleId: 'r1', newScore: 10, reason: '',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.newState.suggestions![0].rule.score).toBe(10);
    }
  });

  it('adjust_score：在 rules 中找到并更新分值（不在 suggestions 时）', () => {
    const rule = makeRule('r2', 3);
    const state = makeState({ rules: [rule] });
    const result = applyProposal(state, {
      type: 'adjust_score', ruleId: 'r2', newScore: 8, reason: '',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.newState.rules![0].score).toBe(8);
    }
  });

  it('adjust_score：不存在 → ok:false', () => {
    const result = applyProposal(makeState(), {
      type: 'adjust_score', ruleId: 'nope', newScore: 10, reason: '',
    });
    expect(result.ok).toBe(false);
  });

  // ============================================================
  // remove_rule
  // ============================================================
  it('remove_rule：从 suggestions 中移除', () => {
    const state = makeState({
      suggestions: [makeSuggestion(makeRule('r1')), makeSuggestion(makeRule('r2'))],
    });
    const result = applyProposal(state, {
      type: 'remove_rule', ruleId: 'r1', reason: '',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.newState.suggestions).toHaveLength(1);
      expect(result.newState.suggestions![0].rule.id).toBe('r2');
    }
  });

  it('remove_rule：从 rules 中移除', () => {
    const state = makeState({ rules: [makeRule('r1'), makeRule('r2')] });
    const result = applyProposal(state, {
      type: 'remove_rule', ruleId: 'r2', reason: '',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.newState.rules).toHaveLength(1);
      expect(result.newState.rules![0].id).toBe('r1');
    }
  });

  it('remove_rule：不存在 → ok:false', () => {
    const result = applyProposal(makeState(), {
      type: 'remove_rule', ruleId: 'nope', reason: '',
    });
    expect(result.ok).toBe(false);
  });

  // ============================================================
  // add_rule
  // ============================================================
  it('add_rule：追加 groundedRule 为新 RuleSuggestion（selected=true）', () => {
    const groundedRule: AnswerRule = {
      id: 'grounded-1',
      action: 'check_field_options',
      params: { tableName: '员工表', fieldName: '状态', options: ['在职', '离职'] },
      score: 0,
    };
    const result = applyProposal(makeState(), {
      type: 'add_rule',
      action: 'check_field_options',
      tableName: '员工表',
      fieldName: '状态',
      reason: '',
      groundedRule,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.newState.suggestions).toHaveLength(1);
      const s = result.newState.suggestions![0];
      expect(s.rule).toBe(groundedRule);
      expect(s.selected).toBe(true);
      expect(s.source.sheetName).toBe('员工表');
      expect(s.source.fieldName).toBe('状态');
    }
  });

  it('add_rule：无 groundedRule → ok:false', () => {
    const result = applyProposal(makeState(), {
      type: 'add_rule',
      action: 'check_field',
      tableName: 'T',
      fieldName: 'F',
      reason: '',
    });
    expect(result.ok).toBe(false);
  });
});
