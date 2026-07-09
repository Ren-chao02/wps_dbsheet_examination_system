/**
 * context-builder — Phase 2 §4.7
 *
 * 题目状态 → LLM messages（系统提示 + 历史）+ ValidationContext。
 * 薄封装：系统提示构建委托给 prompt-templates，本模块负责拼装 messages 与校验上下文。
 */
import type { ChatMessage } from '../llm/llm-client';
import {
  buildSystemPrompt,
  type QuestionState,
} from '../llm/prompt-templates';
import type { ValidationContext } from './proposals';

// ============================================================
// messages 构建
// ============================================================

/**
 * 构建发往 LLMClient 的 messages：系统提示 + 历史。
 * @param params.questionState 当前题目状态（注入系统提示）
 * @param params.history 历史对话（user/assistant，文字 only）
 * @param params.hasStandardAnswer 是否已导入标准答案
 */
export function buildMessages(params: {
  questionState: QuestionState;
  history: ChatMessage[];
  hasStandardAnswer: boolean;
}): ChatMessage[] {
  const systemContent = buildSystemPrompt({
    questionState: params.questionState,
    hasStandardAnswer: params.hasStandardAnswer,
  });
  return [
    { role: 'system', content: systemContent },
    ...params.history,
  ];
}

// ============================================================
// ValidationContext 构建
// ============================================================

/**
 * 从 QuestionState 构造 validateProposal 所需的 ValidationContext。
 * ruleIds 来自 currentRules（合并 suggestions + rules 后的视图）。
 */
export function buildValidationContext(qs: QuestionState): ValidationContext {
  return {
    selectedCapabilityIds: qs.selectedCapabilityIds,
    currentDescription: qs.description,
    ruleIds: qs.currentRules.map(r => r.id),
  };
}
