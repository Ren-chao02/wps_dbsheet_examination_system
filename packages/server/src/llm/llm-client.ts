/**
 * LLMClient 抽象 — Phase 2 §4.1
 *
 * 多 provider 统一接口：流式 chat + tool-calling。
 * coaching-service 仅依赖此接口，不耦合具体厂商。
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /** role='tool' 时：对应的 tool_call id */
  toolCallId?: string;
  /** role='assistant' 且请求了工具时：工具调用列表 */
  toolCalls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  name: string;
  /** 已解析的对象；JSON 损坏时退化为原始字符串 */
  arguments: Record<string, any> | string;
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: object; // JSON Schema
  };
}

export interface ChatChunk {
  /** 文本增量（流式）。最终 chunk 无 delta */
  delta?: string;
  /** 工具调用请求（finishReason='tool_calls' 时随最终 chunk 一次性 yield） */
  toolCalls?: ToolCall[];
  finishReason?: 'stop' | 'tool_calls' | 'length' | 'error';
  usage?: { promptTokens: number; completionTokens: number };
}

export interface ChatParams {
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  temperature?: number;
  maxTokens?: number;
}

export interface LLMClient {
  readonly provider: string;
  chat(params: ChatParams): AsyncIterable<ChatChunk>;
}
