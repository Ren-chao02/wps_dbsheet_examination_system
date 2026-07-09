/**
 * OpenAICompatibleClient — Phase 2 §4.1
 *
 * 适配所有 OpenAI 兼容端点：DeepSeek / Qwen / GLM / Ollama-OpenAI。
 * 用 openai SDK 的流式 chat.completions.create，自行装配跨 delta 分片的 tool_calls。
 *
 * 依赖注入：构造时传入已建好的 OpenAI client，便于测试注入伪造实现。
 */
import type OpenAI from 'openai';
import type {
  ChatChunk,
  ChatParams,
  LLMClient,
  ToolCall,
  ToolDefinition,
} from '../llm-client';

export interface OpenAICompatibleOptions {
  client: OpenAI;
  model: string;
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
}

/** 累积中的 tool_call 分片（按 index 装配） */
interface ToolCallAccumulator {
  index: number;
  id: string;
  name: string;
  arguments: string;
}

export class OpenAICompatibleClient implements LLMClient {
  readonly provider = 'openai-compatible';
  private readonly opts: OpenAICompatibleOptions;

  constructor(opts: OpenAICompatibleOptions) {
    this.opts = opts;
  }

  async *chat(params: ChatParams): AsyncIterable<ChatChunk> {
    const requestParams: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming = {
      model: this.opts.model,
      messages: params.messages.map(this.toOpenAIMessage),
      stream: true,
      temperature: params.temperature ?? this.opts.temperature,
      max_tokens: params.maxTokens ?? this.opts.maxTokens,
    };
    if (params.tools && params.tools.length > 0) {
      requestParams.tools = params.tools.map(this.toOpenAITool);
    }

    const stream = await this.opts.client.chat.completions.create(requestParams, {
      // 超时由 openai SDK 在请求层处理
      timeout: this.opts.timeoutMs,
    }) as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>;

    const toolAccumulators = new Map<number, ToolCallAccumulator>();

    for await (const chunk of stream) {
      const choice = chunk.choices?.[0];
      if (!choice) continue;
      const delta = choice.delta;

      // 文本增量：逐块 yield
      if (delta?.content) {
        yield { delta: delta.content };
      }

      // tool_call 分片：按 index 累积
      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0;
          let acc = toolAccumulators.get(idx);
          if (!acc) {
            acc = { index: idx, id: '', name: '', arguments: '' };
            toolAccumulators.set(idx, acc);
          }
          if (tc.id) acc.id = tc.id;
          if (tc.function?.name) acc.name = tc.function.name;
          if (tc.function?.arguments) acc.arguments += tc.function.arguments;
        }
      }

      // 结束
      if (choice.finish_reason) {
        const finishReason = choice.finish_reason as ChatChunk['finishReason'];
        if (finishReason === 'tool_calls' && toolAccumulators.size > 0) {
          // 按 index 排序，装配完整 ToolCall
          const sorted = [...toolAccumulators.values()].sort((a, b) => a.index - b.index);
          const toolCalls: ToolCall[] = sorted.map(acc => {
            let parsedArgs: Record<string, any> | string;
            try {
              parsedArgs = acc.arguments ? JSON.parse(acc.arguments) : {};
            } catch {
              parsedArgs = acc.arguments; // JSON 损坏退化
            }
            return { id: acc.id, name: acc.name, arguments: parsedArgs };
          });
          yield { toolCalls, finishReason: 'tool_calls' };
        } else {
          yield { finishReason };
        }
      }
    }
  }

  private toOpenAIMessage(msg: ChatParams['messages'][number]): OpenAI.Chat.Completions.ChatCompletionMessageParam {
    switch (msg.role) {
      case 'system':
        return { role: 'system', content: msg.content };
      case 'user':
        return { role: 'user', content: msg.content };
      case 'assistant':
        if (msg.toolCalls && msg.toolCalls.length > 0) {
          return {
            role: 'assistant',
            content: msg.content || null,
            tool_calls: msg.toolCalls.map(tc => ({
              id: tc.id,
              type: 'function' as const,
              function: { name: tc.name, arguments: typeof tc.arguments === 'string' ? tc.arguments : JSON.stringify(tc.arguments) },
            })),
          };
        }
        return { role: 'assistant', content: msg.content };
      case 'tool':
        return { role: 'tool', tool_call_id: msg.toolCallId!, content: msg.content };
    }
  }

  private toOpenAITool(tool: ToolDefinition): OpenAI.Chat.Completions.ChatCompletionTool {
    return {
      type: 'function',
      function: {
        name: tool.function.name,
        description: tool.function.description,
        parameters: tool.function.parameters as Record<string, unknown>,
      },
    };
  }
}
