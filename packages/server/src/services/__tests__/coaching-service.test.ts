/**
 * coaching-service 集成测试 — Phase 2 §3.2 / §7
 *
 * 编排：建上下文 → 调 LLM → 执行 tool → 解析 proposals → ground → 校验 → 输出。
 * mock：fake LLMClient（脚本化 chunks）+ fake adapter。
 */
import { describe, it, expect } from 'vitest';
import { runCoachingChat, type CoachingStreamEvent } from '../coaching-service';
import type { LLMClient, ChatChunk, ChatMessage } from '../../llm/llm-client';
import type { ToolContext } from '../../coaching/tools';
import type { QuestionState } from '../../llm/prompt-templates';
import { AnswerReverser } from '../../engine/answer-reverser';
import type { SchemaResponse } from '../../engine/adapters/kingsoft-adapter';

// ============================================================
// Fixtures
// ============================================================

const sampleQuestionState: QuestionState = {
  title: '员工考勤表',
  description: '请创建一张员工考勤表',
  type: 'practical',
  difficulty: 'medium',
  score: 100,
  selectedCapabilityIds: ['table.create'],
  currentRules: [{ id: 'rule_1', action: 'check_table_exists', tableName: '员工表', score: 20 }],
  hints: '',
};

function makeSchemaForGrounding(): SchemaResponse {
  return {
    result: 0,
    detail: {
      sheets: [
        {
          id: 1,
          name: '员工表',
          primaryFieldId: 'f1',
          fields: [
            { id: 'f1', name: '姓名', type: 'SingleLineText' },
            {
              id: 'f3',
              name: '状态',
              type: 'SingleSelect',
              items: [{ value: '在职' }, { value: '离职' }],
            },
          ],
          views: [{ id: 'v1', name: '表格视图', type: 'Grid' }],
        },
      ],
    },
  };
}

/** fake adapter：返回固定 schema，空记录 */
function makeFakeAdapter(schema: SchemaResponse): any {
  return {
    async getSchema() {
      return schema;
    },
    async getRecordsByTableName(tableName: string) {
      const names = schema.detail.sheets.map(s => s.name);
      if (!names.includes(tableName)) throw new Error(`表 "${tableName}" 不存在`);
      return { records: [], fieldsSchema: [] };
    },
  };
}

/** fake LLMClient：每轮 yield 脚本化 chunks */
function makeFakeClient(rounds: ChatChunk[][]): { client: LLMClient; getCalls: () => number } {
  let calls = 0;
  const client: LLMClient = {
    provider: 'fake',
    async *chat() {
      const round = rounds[calls];
      calls++;
      if (!round) throw new Error('fake client: no more scripted rounds');
      for (const chunk of round) yield chunk;
    },
  };
  return { client, getCalls: () => calls };
}

async function collectEvents(gen: AsyncIterable<CoachingStreamEvent>): Promise<CoachingStreamEvent[]> {
  const events: CoachingStreamEvent[] = [];
  for await (const e of gen) events.push(e);
  return events;
}

function deltaText(events: CoachingStreamEvent[]): string {
  return events.filter(e => e.type === 'delta').map(e => e.text || '').join('');
}

// ============================================================
// 测试
// ============================================================

describe('coaching-service', () => {
  const reverser = new AnswerReverser();

  // ============================================================
  // 纯文本，无 tool call，无 proposals 块
  // ============================================================
  it('纯文本无 proposals 块 → 流式 delta + 空 proposals + note + done', async () => {
    const { client } = makeFakeClient([
      [
        { delta: '这题' },
        { delta: '结构清晰，暂无补充。' },
        { finishReason: 'stop', usage: { promptTokens: 100, completionTokens: 20 } },
      ],
    ]);

    const events = await collectEvents(
      runCoachingChat({
        questionState: sampleQuestionState,
        history: [{ role: 'user', content: '看看这题' }],
        ctx: { adapter: makeFakeAdapter(makeSchemaForGrounding()) } as ToolContext,
        client,
        answerReverser: reverser,
      }),
    );

    expect(deltaText(events)).toBe('这题结构清晰，暂无补充。');
    const proposalsEvent = events.find(e => e.type === 'proposals');
    expect(proposalsEvent).toBeDefined();
    expect(proposalsEvent!.proposals).toEqual([]);
    expect(proposalsEvent!.notes!.length).toBeGreaterThan(0); // 无 proposals 块 note
    const doneEvent = events.find(e => e.type === 'done');
    expect(doneEvent).toBeDefined();
    expect(doneEvent!.usage).toEqual({ promptTokens: 100, completionTokens: 20 });
  });

  // ============================================================
  // tool call → 第二轮返回 add_rule → ground 成功
  // ============================================================
  it('tool call 后返回 add_rule → 执行 tool + ground 出完整规则', async () => {
    const { client, getCalls } = makeFakeClient([
      // Round 0: LLM 请求 tool
      [
        {
          toolCalls: [
            { id: 'tc1', name: 'get_standard_answer_schema', arguments: {} },
          ],
          finishReason: 'tool_calls',
        },
      ],
      // Round 1: LLM 返回文字 + proposals 块（含 add_rule）
      [
        { delta: '建议补一个选项校验考点。\n```proposals\n' },
        {
          delta:
            '[{"type":"add_rule","action":"check_field_options","tableName":"员工表","fieldName":"状态","reason":"补充选项校验"}]\n```',
        },
        { finishReason: 'stop', usage: { promptTokens: 200, completionTokens: 30 } },
      ],
    ]);

    const events = await collectEvents(
      runCoachingChat({
        questionState: sampleQuestionState,
        history: [{ role: 'user', content: '帮我补考点' }],
        ctx: { adapter: makeFakeAdapter(makeSchemaForGrounding()) } as ToolContext,
        client,
        answerReverser: reverser,
      }),
    );

    // LLM 被调用了 2 轮
    expect(getCalls()).toBe(2);
    // 流式文字不含 proposals 块（fence 检测剥离）
    const text = deltaText(events);
    expect(text).toContain('建议补一个选项校验考点');
    expect(text).not.toContain('```proposals');
    expect(text).not.toContain('check_field_options');
    // proposals 事件含 1 条已 ground 的 add_rule
    const proposalsEvent = events.find(e => e.type === 'proposals');
    expect(proposalsEvent!.proposals).toHaveLength(1);
    const p = proposalsEvent!.proposals![0] as any;
    expect(p.type).toBe('add_rule');
    expect(p.action).toBe('check_field_options');
    expect(p.groundedRule).toBeDefined();
    expect(p.groundedRule.params.options).toEqual(['在职', '离职']);
    expect(p.groundedRule.params.tableName).toBe('员工表');
    expect(p.groundedRule.params.fieldName).toBe('状态');
  });

  // ============================================================
  // 无标准答案 → add_rule 丢弃 + note
  // ============================================================
  it('无 adapter 时 add_rule 提案被丢弃并附 note', async () => {
    const { client } = makeFakeClient([
      [
        { delta: '建议补规则。\n```proposals\n' },
        {
          delta:
            '[{"type":"add_rule","action":"check_field","tableName":"员工表","fieldName":"姓名","reason":"补"}]\n```',
        },
        { finishReason: 'stop' },
      ],
    ]);

    const events = await collectEvents(
      runCoachingChat({
        questionState: sampleQuestionState,
        history: [{ role: 'user', content: '帮我补规则' }],
        ctx: {} as ToolContext, // 无 adapter
        client,
        answerReverser: reverser,
      }),
    );

    const proposalsEvent = events.find(e => e.type === 'proposals');
    expect(proposalsEvent!.proposals).toEqual([]);
    expect(proposalsEvent!.notes!.some(n => n.includes('add_rule') || n.includes('ground'))).toBe(true);
  });

  // ============================================================
  // proposals 块损坏 → 空数组 + note
  // ============================================================
  it('proposals 块 JSON 损坏 → 空数组 + note', async () => {
    const { client } = makeFakeClient([
      [
        { delta: '建议如下。\n```proposals\n{bad json}\n```' },
        { finishReason: 'stop' },
      ],
    ]);

    const events = await collectEvents(
      runCoachingChat({
        questionState: sampleQuestionState,
        history: [{ role: 'user', content: '建议' }],
        ctx: { adapter: makeFakeAdapter(makeSchemaForGrounding()) } as ToolContext,
        client,
        answerReverser: reverser,
      }),
    );

    const proposalsEvent = events.find(e => e.type === 'proposals');
    expect(proposalsEvent!.proposals).toEqual([]);
    expect(proposalsEvent!.notes!.some(n => n.includes('解析失败') || n.includes('损坏'))).toBe(true);
  });

  // ============================================================
  // 校验失败的提案被丢弃（如不存在的 ruleId）
  // ============================================================
  it('adjust_score 指向不存在的 ruleId → 丢弃 + note', async () => {
    const { client } = makeFakeClient([
      [
        {
          delta:
            '调分。\n```proposals\n[{"type":"adjust_score","ruleId":"fake_rule","newScore":50,"reason":"x"}]\n```',
        },
        { finishReason: 'stop' },
      ],
    ]);

    const events = await collectEvents(
      runCoachingChat({
        questionState: sampleQuestionState,
        history: [{ role: 'user', content: '调分' }],
        ctx: { adapter: makeFakeAdapter(makeSchemaForGrounding()) } as ToolContext,
        client,
        answerReverser: reverser,
      }),
    );

    const proposalsEvent = events.find(e => e.type === 'proposals');
    expect(proposalsEvent!.proposals).toEqual([]);
    expect(proposalsEvent!.notes!.some(n => n.includes('fake_rule') || n.includes('不存在'))).toBe(true);
  });

  // ============================================================
  // 非规则类建议（add_hint）正常通过
  // ============================================================
  it('add_hint 提案正常通过校验', async () => {
    const { client } = makeFakeClient([
      [
        {
          delta:
            '补提示。\n```proposals\n[{"type":"add_hint","hint":"注意选项大小写","reason":"易错点"}]\n```',
        },
        { finishReason: 'stop' },
      ],
    ]);

    const events = await collectEvents(
      runCoachingChat({
        questionState: sampleQuestionState,
        history: [{ role: 'user', content: '补提示' }],
        ctx: {} as ToolContext,
        client,
        answerReverser: reverser,
      }),
    );

    const proposalsEvent = events.find(e => e.type === 'proposals');
    expect(proposalsEvent!.proposals).toHaveLength(1);
    expect((proposalsEvent!.proposals![0] as any).type).toBe('add_hint');
    expect((proposalsEvent!.proposals![0] as any).hint).toBe('注意选项大小写');
  });

  // ============================================================
  // maxToolRounds 超限 → error
  // ============================================================
  it('LLM 持续 tool_call 超 maxToolRounds → error 事件', async () => {
    // 每轮都返回 tool_call，永不 stop
    const endlessRounds = Array.from({ length: 20 }, () => [
      {
        toolCalls: [{ id: 'tc', name: 'get_capability_detail', arguments: { capabilityId: 'table.create' } }],
        finishReason: 'tool_calls' as const,
      },
    ]);

    const { client } = makeFakeClient(endlessRounds);

    const events = await collectEvents(
      runCoachingChat({
        questionState: sampleQuestionState,
        history: [{ role: 'user', content: '问' }],
        ctx: { adapter: makeFakeAdapter(makeSchemaForGrounding()) } as ToolContext,
        client,
        answerReverser: reverser,
        maxToolRounds: 3,
      }),
    );

    const errorEvent = events.find(e => e.type === 'error');
    expect(errorEvent).toBeDefined();
    expect(errorEvent!.message).toMatch(/轮次|round|超/i);
  });

  // ============================================================
  // LLM 抛错 → error 事件
  // ============================================================
  it('LLM client 抛错 → error 事件', async () => {
    const { client } = makeFakeClient([]); // 无脚本 rounds → 第一轮就抛

    const events = await collectEvents(
      runCoachingChat({
        questionState: sampleQuestionState,
        history: [{ role: 'user', content: '问' }],
        ctx: {} as ToolContext,
        client,
        answerReverser: reverser,
      }),
    );

    const errorEvent = events.find(e => e.type === 'error');
    expect(errorEvent).toBeDefined();
  });

  // ============================================================
  // 多条建议卡混合：部分有效部分无效
  // ============================================================
  it('混合建议卡：有效 add_hint + 无效 adjust_score → 只保留有效的 + note', async () => {
    const { client } = makeFakeClient([
      [
        {
          delta:
            '建议。\n```proposals\n[{"type":"add_hint","hint":"提示A","reason":"r1"},{"type":"adjust_score","ruleId":"nope","newScore":5,"reason":"r2"}]\n```',
        },
        { finishReason: 'stop' },
      ],
    ]);

    const events = await collectEvents(
      runCoachingChat({
        questionState: sampleQuestionState,
        history: [{ role: 'user', content: '建议' }],
        ctx: {} as ToolContext,
        client,
        answerReverser: reverser,
      }),
    );

    const proposalsEvent = events.find(e => e.type === 'proposals');
    expect(proposalsEvent!.proposals).toHaveLength(1);
    expect((proposalsEvent!.proposals![0] as any).type).toBe('add_hint');
    expect(proposalsEvent!.notes!.some(n => n.includes('nope'))).toBe(true);
  });
});
