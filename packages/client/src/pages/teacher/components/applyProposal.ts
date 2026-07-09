/**
 * applyProposal — Phase 2 §5.2 建议卡应用逻辑
 *
 * 纯函数：接收当前题目状态 + 一条建议卡，返回新状态（部分字段）。
 * QuestionEditor 持有此函数的包装版（含 React state setters），下传 CoachingPanel。
 *
 * mutateRuleById / removeRuleById 先查 suggestions（按 rule.id）再查 rules，
 * 兼顾"未应用"与"已应用"两种状态。
 *
 * @see docs/superpowers/specs/2026-07-08-phase2-ai-coaching-design.md §5.2
 */
import type { Proposal, AnswerRule, RuleSuggestion } from '../../../types';

/** applyProposal 所需的当前题目状态快照 */
export interface QuestionStateForApply {
  selectedCapabilityIds: string[];
  suggestions: RuleSuggestion[];
  rules: AnswerRule[];
  description: string;
  hints: string;
}

export type ApplyResult =
  | { ok: true; newState: Partial<QuestionStateForApply> }
  | { ok: false; reason: string };

export function applyProposal(
  state: QuestionStateForApply,
  proposal: Proposal,
): ApplyResult {
  switch (proposal.type) {
    case 'add_capability': {
      if (state.selectedCapabilityIds.includes(proposal.capabilityId)) {
        return { ok: false, reason: '该能力已选' };
      }
      return {
        ok: true,
        newState: {
          selectedCapabilityIds: [...state.selectedCapabilityIds, proposal.capabilityId],
        },
      };
    }

    case 'rewrite_description': {
      return {
        ok: true,
        newState: { description: proposal.newDescription },
      };
    }

    case 'add_hint': {
      const cur = state.hints || '';
      const newHints = cur + (cur ? '\n' : '') + proposal.hint;
      return { ok: true, newState: { hints: newHints } };
    }

    case 'adjust_score': {
      let found = false;
      const suggestions = state.suggestions.map((s) => {
        if (s.rule.id === proposal.ruleId) {
          found = true;
          return { ...s, rule: { ...s.rule, score: proposal.newScore } };
        }
        return s;
      });
      let rules = state.rules;
      if (!found) {
        rules = state.rules.map((r) => {
          if (r.id === proposal.ruleId) {
            found = true;
            return { ...r, score: proposal.newScore };
          }
          return r;
        });
      }
      if (!found) return { ok: false, reason: `规则「${proposal.ruleId}」不存在` };
      return { ok: true, newState: { suggestions, rules } };
    }

    case 'remove_rule': {
      let found = false;
      const suggestions = state.suggestions.filter((s) => {
        if (s.rule.id === proposal.ruleId) {
          found = true;
          return false;
        }
        return true;
      });
      let rules = state.rules;
      if (!found) {
        rules = state.rules.filter((r) => {
          if (r.id === proposal.ruleId) {
            found = true;
            return false;
          }
          return true;
        });
      }
      if (!found) return { ok: false, reason: `规则「${proposal.ruleId}」不存在` };
      return { ok: true, newState: { suggestions, rules } };
    }

    case 'add_rule': {
      if (!proposal.groundedRule) {
        return { ok: false, reason: '规则未 ground' };
      }
      const newSuggestion: RuleSuggestion = {
        rule: proposal.groundedRule,
        source: {
          sheetName: proposal.tableName,
          sheetId: 0,
          fieldName: proposal.fieldName,
          capabilityId: '',
        },
        editable: false,
        selected: true,
        missingParams: [],
      };
      return {
        ok: true,
        newState: { suggestions: [...state.suggestions, newSuggestion] },
      };
    }
  }
}
