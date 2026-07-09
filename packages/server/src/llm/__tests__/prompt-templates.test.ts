/**
 * prompt-templates 测试 — Phase 2 §4.7
 *
 * 系统提示构建 + proposals 块解析。
 * 系统提示含：角色 / 题目状态 / 能力图谱摘要 / 工具清单 / 建议卡规则 / 回复格式。
 */
import { describe, it, expect } from 'vitest';
import {
  buildCapabilitySummary,
  buildSystemPrompt,
  parseProposalsBlock,
} from '../prompt-templates';
import { CAPABILITY_GRAPH } from '../../data/capability-graph';

const sampleQuestionState = {
  title: '员工考勤表',
  description: '请创建一张员工考勤表',
  type: 'practical',
  difficulty: 'medium',
  score: 100,
  selectedCapabilityIds: ['table.create', 'field.single_select'],
  currentRules: [
    { id: 'r1', action: 'check_table_exists', tableName: '考勤表', score: 20 },
  ],
  hints: '',
};

describe('prompt-templates', () => {
  // ============================================================
  // buildCapabilitySummary
  // ============================================================
  describe('buildCapabilitySummary', () => {
    it('包含全部 66 项能力的 id', () => {
      const summary = buildCapabilitySummary();
      for (const cap of CAPABILITY_GRAPH) {
        expect(summary).toContain(cap.id);
      }
    });

    it('包含能力名和域', () => {
      const summary = buildCapabilitySummary();
      const first = CAPABILITY_GRAPH[0];
      expect(summary).toContain(first.name);
      expect(summary).toContain(first.domain);
    });

    it('包含 promptHints（已填充）', () => {
      const summary = buildCapabilitySummary();
      const withHints = CAPABILITY_GRAPH.find(c => c.promptHints);
      if (withHints) {
        expect(summary).toContain(withHints.promptHints!);
      }
    });
  });

  // ============================================================
  // buildSystemPrompt
  // ============================================================
  describe('buildSystemPrompt', () => {
    it('含角色描述（出题教练）', () => {
      const prompt = buildSystemPrompt({ questionState: sampleQuestionState });
      expect(prompt).toContain('教练');
    });

    it('含题目状态 JSON（标题/描述/已选能力/当前规则）', () => {
      const prompt = buildSystemPrompt({ questionState: sampleQuestionState });
      expect(prompt).toContain('员工考勤表');
      expect(prompt).toContain('请创建一张员工考勤表');
      expect(prompt).toContain('table.create');
      expect(prompt).toContain('check_table_exists');
    });

    it('含能力图谱摘要标记', () => {
      const prompt = buildSystemPrompt({ questionState: sampleQuestionState });
      expect(prompt).toContain('能力图谱');
      // 摘要内联进系统提示
      expect(prompt).toContain(CAPABILITY_GRAPH[0].id);
    });

    it('含 3 个工具名', () => {
      const prompt = buildSystemPrompt({ questionState: sampleQuestionState });
      expect(prompt).toContain('get_capability_detail');
      expect(prompt).toContain('get_standard_answer_schema');
      expect(prompt).toContain('get_records');
    });

    it('含建议卡规则：add_rule 白名单 + 不产参数 + 视图/表单/记录值不提', () => {
      const prompt = buildSystemPrompt({ questionState: sampleQuestionState });
      expect(prompt).toContain('add_rule');
      expect(prompt).toContain('check_field');
      expect(prompt).toMatch(/不要.*参数|参数.*系统.*解析/);
      expect(prompt).toMatch(/视图|表单|记录值/);
    });

    it('含回复格式约定（```proposals 块）', () => {
      const prompt = buildSystemPrompt({ questionState: sampleQuestionState });
      expect(prompt).toContain('proposals');
    });

    it('未导入标准答案时含降级提示（add_rule 不可用）', () => {
      const prompt = buildSystemPrompt({
        questionState: sampleQuestionState,
        hasStandardAnswer: false,
      });
      expect(prompt).toMatch(/未导入标准答案|add_rule.*不可用/);
    });
  });

  // ============================================================
  // parseProposalsBlock
  // ============================================================
  describe('parseProposalsBlock', () => {
    it('正常提取 proposals JSON 数组，并从 displayText 中剥离该块', () => {
      const text =
        '这题可以补一个单选字段考点。\n```proposals\n[{"type":"add_hint","hint":"注意选项","reason":"补充"}]\n```\n';
      const { proposals, displayText, notes } = parseProposalsBlock(text);
      expect(proposals).toHaveLength(1);
      expect(proposals[0].type).toBe('add_hint');
      expect(displayText).not.toContain('```proposals');
      expect(displayText).toContain('这题可以补一个单选字段考点');
      expect(notes).toEqual([]);
    });

    it('无 proposals 块 → 空数组 + note', () => {
      const text = '这题没什么好补充的了。';
      const { proposals, displayText, notes } = parseProposalsBlock(text);
      expect(proposals).toEqual([]);
      expect(displayText).toBe(text);
      expect(notes.some(n => n.includes('proposals') || n.includes('建议卡'))).toBe(true);
    });

    it('proposals 块 JSON 损坏 → 空数组 + note + 剥离坏块', () => {
      const text =
        '建议如下。\n```proposals\n{not valid json}\n```\n';
      const { proposals, displayText, notes } = parseProposalsBlock(text);
      expect(proposals).toEqual([]);
      expect(displayText).not.toContain('```proposals');
      expect(notes.some(n => n.includes('解析失败') || n.includes('损坏'))).toBe(true);
    });

    it('proposals 块为空数组 → 空数组 + 无 note', () => {
      const text = '无需建议。\n```proposals\n[]\n```\n';
      const { proposals, displayText, notes } = parseProposalsBlock(text);
      expect(proposals).toEqual([]);
      expect(notes).toEqual([]);
      expect(displayText).not.toContain('```proposals');
    });

    it('proposals 块不是数组（如对象）→ 空数组 + note', () => {
      const text =
        '建议如下。\n```proposals\n{"type":"add_hint"}\n```\n';
      const { proposals, notes } = parseProposalsBlock(text);
      expect(proposals).toEqual([]);
      expect(notes.length).toBeGreaterThan(0);
    });

    it('多个 proposals 块只取第一个', () => {
      const text =
        '```proposals\n[{"type":"add_hint","hint":"a","reason":"b"}]\n```\n```proposals\n[]\n```\n';
      const { proposals } = parseProposalsBlock(text);
      expect(proposals).toHaveLength(1);
      expect(proposals[0].hint).toBe('a');
    });
  });
});
