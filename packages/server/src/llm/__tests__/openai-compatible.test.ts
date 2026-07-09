import { describe, it, expect } from 'vitest';
import { OpenAICompatibleClient } from '../providers/openai-compatible';
import type { ChatChunk } from '../llm-client';

/**
 * OpenAICompatibleClient 契约测试 — Phase 2 §4.1
 *
 * 注入伪造的 OpenAI client（实现 chat.completions.create 返回异步可迭代流），
 * 验证客户端把 OpenAI 流式 chunk 正确翻译为 ChatChunk：
 * - delta.content → ChatChunk.delta（逐块 yield）
 * - tool_calls 跨 delta 分片 → 装配为完整 ToolCall，finishReason='tool_calls' 时 yield
 * - finish_reason='stop' → yield 最终 ChatChunk
 */

/** 构造伪造 OpenAI client，按给定原始 chunk 序列流式返回 */
function makeFakeOpenAI(rawChunks: any[]) {
  return {
    chat: {
      completions: {
        create: async (_params: any) => {
          async function* gen() {
            for (const c of rawChunks) yield c;
          }
          return gen();
        },
      },
    },
  };
}

async function collect(it: AsyncIterable<ChatChunk>): Promise<ChatChunk[]> {
  const out: ChatChunk[] = [];
  for await (const c of it) out.push(c);
  return out;
}

describe('OpenAICompatibleClient — 纯文本流', () => {
  it('delta.content 逐块 yield，末尾 finishReason=stop', async () => {
    const fake = makeFakeOpenAI([
      { choices: [{ delta: { content: '你' }, finish_reason: null }] },
      { choices: [{ delta: { content: '好' }, finish_reason: null }] },
      { choices: [{ delta: {}, finish_reason: 'stop' }] },
    ]);
    const client = new OpenAICompatibleClient({
      client: fake as any,
      model: 'deepseek-chat',
      temperature: 0.4,
      maxTokens: 100,
      timeoutMs: 5000,
    });

    const chunks = await collect(client.chat({ messages: [{ role: 'user', content: 'hi' }] }));

    const deltas = chunks.filter(c => c.delta !== undefined).map(c => c.delta);
    expect(deltas).toEqual(['你', '好']);
    const last = chunks[chunks.length - 1];
    expect(last.finishReason).toBe('stop');
    expect(last.delta).toBeUndefined();
  });
});

describe('OpenAICompatibleClient — tool_calls 装配', () => {
  it('跨 delta 分片的 tool_call 装配为完整 ToolCall，finishReason=tool_calls', async () => {
    // 模拟 OpenAI 流式 tool_call：首块给 id+name，后续块分片给 arguments
    const fake = makeFakeOpenAI([
      {
        choices: [{
          delta: {
            tool_calls: [{
              index: 0,
              id: 'call_1',
              function: { name: 'get_records', arguments: '' },
            }],
          },
          finish_reason: null,
        }],
      },
      {
        choices: [{
          delta: {
            tool_calls: [{
              index: 0,
              function: { arguments: '{"table' },
            }],
          },
          finish_reason: null,
        }],
      },
      {
        choices: [{
          delta: {
            tool_calls: [{
              index: 0,
              function: { arguments: 'Name":"员工表"}' },
            }],
          },
          finish_reason: null,
        }],
      },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
    ]);
    const client = new OpenAICompatibleClient({
      client: fake as any, model: 'm', temperature: 0, maxTokens: 10, timeoutMs: 5000,
    });

    const chunks = await collect(client.chat({
      messages: [{ role: 'user', content: 'go' }],
      tools: [{
        type: 'function',
        function: { name: 'get_records', description: '', parameters: {} },
      }],
    }));

    const final = chunks[chunks.length - 1];
    expect(final.finishReason).toBe('tool_calls');
    expect(final.toolCalls).toEqual([
      { id: 'call_1', name: 'get_records', arguments: { tableName: '员工表' } },
    ]);
  });

  it('多个 tool_call 并行装配', async () => {
    const fake = makeFakeOpenAI([
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'a', function: { name: 'f1', arguments: '{}' } }] }, finish_reason: null }] },
      { choices: [{ delta: { tool_calls: [{ index: 1, id: 'b', function: { name: 'f2', arguments: '{}' } }] }, finish_reason: null }] },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
    ]);
    const client = new OpenAICompatibleClient({
      client: fake as any, model: 'm', temperature: 0, maxTokens: 10, timeoutMs: 5000,
    });
    const chunks = await collect(client.chat({ messages: [{ role: 'user', content: 'x' }] }));
    const final = chunks[chunks.length - 1];
    expect(final.toolCalls).toHaveLength(2);
    expect(final.toolCalls!.map(t => t.id)).toEqual(['a', 'b']);
  });
});

describe('OpenAICompatibleClient — arguments JSON 损坏', () => {
  it('arguments 非法 JSON 时 arguments 退化为原始字符串', async () => {
    const fake = makeFakeOpenAI([
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'a', function: { name: 'f', arguments: 'not-json' } }] }, finish_reason: null }] },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
    ]);
    const client = new OpenAICompatibleClient({
      client: fake as any, model: 'm', temperature: 0, maxTokens: 10, timeoutMs: 5000,
    });
    const chunks = await collect(client.chat({ messages: [{ role: 'user', content: 'x' }] }));
    const final = chunks[chunks.length - 1];
    expect(final.toolCalls![0].arguments).toBe('not-json');
  });
});
