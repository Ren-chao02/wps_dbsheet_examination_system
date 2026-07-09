/**
 * 建议卡协议 — Phase 2 §4.4
 *
 * LLM 回复尾部以 ```proposals JSON 块返回建议卡数组。
 * 服务端解析后逐条用 validateProposal 做结构性校验；
 * add_rule 卡再交由 answerReverser.groundProposal 从真实 Schema 解析参数。
 *
 * 不变量：LLM 永不产出规则参数。add_rule 卡只带「意图」(action + 实体引用)。
 */
import { findCapability } from '../data/capability-graph';
import type { AnswerRule } from '../engine/rule-engine';

// ============================================================
// 类型定义
// ============================================================

/** LLM 产出的建议卡（add_rule 的 groundedRule 由服务端 ground 后回填，前端用） */
export type Proposal =
  | { type: 'add_capability'; capabilityId: string; reason: string }
  | { type: 'rewrite_description'; newDescription: string; reason: string }
  | { type: 'adjust_score'; ruleId: string; newScore: number; reason: string }
  | { type: 'remove_rule'; ruleId: string; reason: string }
  | { type: 'add_hint'; hint: string; reason: string }
  | {
      type: 'add_rule';
      action: string;
      tableName: string;
      fieldName?: string;
      reason: string;
      /** 服务端 ground 后回填；LLM 不产出 */
      groundedRule?: AnswerRule;
    };

/** add_rule 子集（groundProposal 输入） */
export interface AddRuleProposal {
  action: string;
  tableName: string;
  fieldName?: string;
}

/**
 * add_rule 白名单 — MVP 只支持能从 Schema 确定性 ground 的字段级/表级 action。
 * 视图/表单/记录值/记录数/关联记录规则 grounding 有歧义，留 Phase 3。
 */
export const ADD_RULE_WHITELIST: ReadonlySet<string> = new Set([
  'check_field',
  'check_field_options',
  'check_field_required',
  'check_field_unique',
  'check_field_format',
  'check_field_link_target',
  'check_table_exists',
  'check_table_name',
  'check_table_fields',
  'check_field_count',
]);

/** 需要 fieldName 的字段级 action */
const FIELD_LEVEL_ACTIONS = new Set([
  'check_field',
  'check_field_options',
  'check_field_required',
  'check_field_unique',
  'check_field_format',
  'check_field_link_target',
]);

/** 表级 action（无需 fieldName） */
const TABLE_LEVEL_ACTIONS = new Set([
  'check_table_exists',
  'check_table_name',
  'check_table_fields',
  'check_field_count',
]);

// ============================================================
// 校验
// ============================================================

/** 校验上下文：当前题目状态（结构性校验用，不含 Schema） */
export interface ValidationContext {
  selectedCapabilityIds: string[];
  currentDescription: string;
  /** 当前 suggestions + rules 的所有 ruleId */
  ruleIds: string[];
}

export type ValidationResult = { ok: true } | { ok: false; reason: string };

/**
 * 结构性校验一条建议卡。不依赖 Schema（tableName 是否在 Schema 内由 groundProposal 负责）。
 */
export function validateProposal(p: Proposal, ctx: ValidationContext): ValidationResult {
  switch (p.type) {
    case 'add_capability': {
      const cap = findCapability(p.capabilityId);
      if (!cap) return { ok: false, reason: `能力「${p.capabilityId}」不存在` };
      if (ctx.selectedCapabilityIds.includes(p.capabilityId)) {
        return { ok: false, reason: `能力「${p.capabilityId}」已选` };
      }
      return { ok: true };
    }

    case 'rewrite_description': {
      const desc = (p.newDescription || '').trim();
      if (!desc) return { ok: false, reason: '新描述为空' };
      if (desc === (ctx.currentDescription || '').trim()) {
        return { ok: false, reason: '新描述与当前相同' };
      }
      return { ok: true };
    }

    case 'adjust_score': {
      if (!ctx.ruleIds.includes(p.ruleId)) {
        return { ok: false, reason: `规则「${p.ruleId}」不存在` };
      }
      if (typeof p.newScore !== 'number' || p.newScore < 0) {
        return { ok: false, reason: '分值无效' };
      }
      return { ok: true };
    }

    case 'remove_rule': {
      if (!ctx.ruleIds.includes(p.ruleId)) {
        return { ok: false, reason: `规则「${p.ruleId}」不存在` };
      }
      return { ok: true };
    }

    case 'add_hint': {
      if (!(p.hint || '').trim()) return { ok: false, reason: '提示为空' };
      return { ok: true };
    }

    case 'add_rule': {
      if (!ADD_RULE_WHITELIST.has(p.action)) {
        return { ok: false, reason: `action「${p.action}」不在 add_rule 白名单` };
      }
      if (!(p.tableName || '').trim()) {
        return { ok: false, reason: 'tableName 为空' };
      }
      if (FIELD_LEVEL_ACTIONS.has(p.action) && !(p.fieldName || '').trim()) {
        return { ok: false, reason: `字段级 action「${p.action}」需要 fieldName` };
      }
      return { ok: true };
    }

    default:
      return { ok: false, reason: `未知建议卡类型：${(p as any).type}` };
  }
}

/** 判断 add_rule 提案是否为表级 action */
export function isTableLevelAction(action: string): boolean {
  return TABLE_LEVEL_ACTIONS.has(action);
}
