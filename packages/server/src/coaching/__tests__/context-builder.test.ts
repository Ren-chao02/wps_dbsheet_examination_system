/**
 * context-builder 测试 — Phase 2 §4.7
 *
 * 题目状态 → LLM messages（系统提示 + 历史）+ ValidationContext。
 */
import { describe, it, expect } from 'vitest';
import {
  buildMessages,
  buildValidationContext,
} from '../context-builder';
import type { QuestionState } from '../../llm/prompt-templates';
import type { ChatMessage } from '../../llm/llm-client';

const sampleQuestionState: QuestionState = {
  title: '员工考勤表',
  description: '请创建一张员工考勤表',
  type: 'practical',
  difficulty: 'medium',
  score: 100,
  selectedCapabilityIds: ['table.create', 'field.single_select'],
  currentRules: [
    { id: 'rule_1', action: 'check_table_exists', tableName: '考勤表', score: 20 },
    { id: 'rule_2', action: 'check_field', tableName: '考勤表', fieldName: '状态', score: 10 },
  ],
  hints: '',
};

describe('context-builder', () => {
  // ============================================================
  // buildMessages
  // ============================================================
  describe('buildMessages', () => {
    it('首条消息是 system 提示', () => {
      const messages = buildMessages({
        questionState: sampleQuestionState,
        history: [],
        hasStandardAnswer: true,
      });
      expect(messages[0].role).toBe('system');
      expect(messages[0].content).toContain('教练');
    });

    it('history 消息按顺序追加在 system 之后', () => {
      const history: ChatMessage[] = [
        { role: 'user', content: '看看这题' },
        { role: 'assistant', content: '建议补…' },
        { role: 'user', content: '再帮我看分值' },
      ];
      const messages = buildMessages({
        questionState: sampleQuestionState,
        history,
        hasStandardAnswer: true,
      });
      expect(messages).toHaveLength(4);
      expect(messages[1]).toEqual(history[0]);
      expect(messages[2]).toEqual(history[1]);
      expect(messages[3]).toEqual(history[2]);
    });

    it('hasStandardAnswer=false 时系统提示含降级提示', () => {
      const messages = buildMessages({
        questionState: sampleQuestionState,
        history: [],
        hasStandardAnswer: false,
      });
      expect(messages[0].content).toMatch(/未导入标准答案|add_rule.*不可用/);
    });

    it('空 history 仍返回仅含 system 的数组', () => {
      const messages = buildMessages({
        questionState: sampleQuestionState,
        history: [],
        hasStandardAnswer: true,
      });
      expect(messages).toHaveLength(1);
      expect(messages[0].role).toBe('system');
    });
  });

  // ============================================================
  // buildValidationContext
  // ============================================================
  describe('buildValidationContext', () => {
    it('从 QuestionState 提取 selectedCapabilityIds / currentDescription / ruleIds', () => {
      const ctx = buildValidationContext(sampleQuestionState);
      expect(ctx.selectedCapabilityIds).toEqual(['table.create', 'field.single_select']);
      expect(ctx.currentDescription).toBe('请创建一张员工考勤表');
      expect(ctx.ruleIds).toEqual(['rule_1', 'rule_2']);
    });

    it('空 currentRules → ruleIds 为空数组', () => {
      const ctx = buildValidationContext({
        ...sampleQuestionState,
        currentRules: [],
      });
      expect(ctx.ruleIds).toEqual([]);
    });
  });
});
