/**
 * LLM 大模型配置服务 — DB 持久化 + env 兜底
 *
 * 优先级：DB 配置 > .env 环境变量
 * - 管理员在前端配置后存入 DB，覆盖 env
 * - DB 无配置时自动回退到 .env（兼容现有部署）
 *
 * API Key 安全：
 * - getMasked() 返回脱敏 key（前3后4，中间星号），供前端展示
 * - save() 时 apiKey 为空 = 保留旧值（用户不改 key 时无需重新输入）
 *
 * @see wps-config-service.ts（同模式）
 */
import { prisma } from '../config/prisma';
import { config } from '../config';
import { createLLMClient } from '../llm/create-client';

/** 生效的 LLM 配置（供 createLLMClient 使用） */
export interface LlmEffectiveConfig {
  provider: string;
  apiKey: string;
  baseURL: string;
  model: string;
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
  rateLimitPerMin: number;
  source: 'db' | 'env';
}

/** 脱敏的 LLM 配置（供前端展示） */
export interface LlmMaskedConfig {
  provider: string;
  hasApiKey: boolean;
  apiKeyMasked: string;
  baseURL: string;
  model: string;
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
  rateLimitPerMin: number;
  source: 'db' | 'env';
}

/** save 入参 */
export interface LlmConfigInput {
  provider: string;
  apiKey: string;
  baseURL: string;
  model: string;
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
  rateLimitPerMin: number;
}

/** 测试连接结果 */
export interface TestConnectionResult {
  ok: boolean;
  provider: string;
  model: string;
  /** 成功时：一次往返耗时 */
  latencyMs?: number;
  /** 成功时：模型回显的简短回复（可能为空） */
  reply?: string;
  /** 人类可读的结论（成功或失败原因） */
  message: string;
  /** 失败时：底层错误原文（服务商报错 / 网络错误） */
  detail?: string;
  errorType?:
    | 'no_api_key'
    | 'invalid_api_key'
    | 'invalid_model'
    | 'rate_limit'
    | 'timeout'
    | 'network'
    | 'other';
}

/** 脱敏 API Key：保留前3后4，中间用星号填充；太短则全星号 */
function maskApiKey(key: string): string {
  if (!key) return '';
  if (key.length <= 7) return '****';
  return key.slice(0, 3) + '*'.repeat(key.length - 7) + key.slice(-4);
}

/** 把底层异常归类为人类可读的失败原因 */
function classifyTestError(
  status: number | undefined,
  rawMsg: string,
): { message: string; errorType: Exclude<TestConnectionResult['errorType'], undefined> } {
  // 超时（openai SDK：APIConnectionTimeoutError，code=ECONNABORTED，无 status）
  if (!status && /timeout|timed out|ECONNABORTED|aborted|abort/i.test(rawMsg)) {
    return { message: '连接超时，请检查网络或调大超时时间', errorType: 'timeout' };
  }
  switch (status) {
    case 401:
      return { message: 'API Key 无效（401 Unauthorized）', errorType: 'invalid_api_key' };
    case 403:
      return { message: '无权限访问（403），请检查 API Key 的权限范围', errorType: 'invalid_api_key' };
    case 404:
      return { message: '模型或端点不存在（404），请检查模型名称与 Base URL', errorType: 'invalid_model' };
    case 429:
      return { message: '请求过于频繁或账户额度不足（429）', errorType: 'rate_limit' };
    default:
      if (status) {
        return { message: `服务商返回错误（HTTP ${status}）`, errorType: 'other' };
      }
      return { message: '网络连接失败，请检查 Base URL 与网络', errorType: 'network' };
  }
}

export const llmConfigService = {
  /** 从 DB 读取原始配置 */
  async get() {
    return prisma.llmConfig.findUnique({ where: { id: 'llm_config' } });
  },

  /**
   * 保存配置到 DB（upsert）。
   * apiKey 为空时保留 DB 中已有的旧值（用户不改 key 时无需重新输入）。
   */
  async save(input: LlmConfigInput) {
    let apiKey = input.apiKey;
    if (!apiKey) {
      const existing = await this.get();
      apiKey = existing?.apiKey || '';
    }

    return prisma.llmConfig.upsert({
      where: { id: 'llm_config' },
      create: {
        id: 'llm_config',
        provider: input.provider,
        apiKey,
        baseURL: input.baseURL,
        model: input.model,
        temperature: input.temperature,
        maxTokens: input.maxTokens,
        timeoutMs: input.timeoutMs,
        rateLimitPerMin: input.rateLimitPerMin,
      },
      update: {
        provider: input.provider,
        apiKey,
        baseURL: input.baseURL,
        model: input.model,
        temperature: input.temperature,
        maxTokens: input.maxTokens,
        timeoutMs: input.timeoutMs,
        rateLimitPerMin: input.rateLimitPerMin,
      },
    });
  },

  /** 清除 DB 配置（回退到 env） */
  async clear() {
    return prisma.llmConfig.deleteMany({ where: { id: 'llm_config' } });
  },

  /**
   * 获取生效配置：DB 有则用 DB，否则回退到 env。
   * 供 createLLMClient 使用。
   */
  async getEffective(): Promise<LlmEffectiveConfig> {
    const dbConfig = await this.get();
    if (dbConfig) {
      return {
        provider: dbConfig.provider,
        apiKey: dbConfig.apiKey,
        baseURL: dbConfig.baseURL,
        model: dbConfig.model,
        temperature: dbConfig.temperature,
        maxTokens: dbConfig.maxTokens,
        timeoutMs: dbConfig.timeoutMs,
        rateLimitPerMin: dbConfig.rateLimitPerMin,
        source: 'db',
      };
    }
    // 回退到 env
    return {
      provider: config.llm.provider,
      apiKey: config.llm.apiKey,
      baseURL: config.llm.baseURL,
      model: config.llm.model,
      temperature: config.llm.temperature,
      maxTokens: config.llm.maxTokens,
      timeoutMs: config.llm.timeoutMs,
      rateLimitPerMin: config.llm.rateLimitPerMin,
      source: 'env',
    };
  },

  /**
   * 获取脱敏配置（供前端展示）。
   * apiKey 被脱敏为 sk-****abcd 格式。
   */
  async getMasked(): Promise<LlmMaskedConfig> {
    const effective = await this.getEffective();
    return {
      provider: effective.provider,
      hasApiKey: !!effective.apiKey,
      apiKeyMasked: maskApiKey(effective.apiKey),
      baseURL: effective.baseURL,
      model: effective.model,
      temperature: effective.temperature,
      maxTokens: effective.maxTokens,
      timeoutMs: effective.timeoutMs,
      rateLimitPerMin: effective.rateLimitPerMin,
      source: effective.source,
    };
  },

  /**
   * 测试连接：用「表单当前值」发起一次最小 LLM 调用，验证 Key/模型/Base URL 是否可用。
   * 不写入 DB；apiKey 为空时回退到已生效配置（DB > env）的 Key，与 save 语义一致。
   */
  async testConnection(input: LlmConfigInput): Promise<TestConnectionResult> {
    const base: TestConnectionResult = {
      ok: false,
      provider: input.provider,
      model: input.model,
      message: '',
    };

    // apiKey 为空 = 复用已生效（DB/env）的 Key
    const effective = await this.getEffective();
    const apiKey = input.apiKey || effective.apiKey;

    if (!apiKey && input.provider !== 'ollama') {
      return {
        ...base,
        message: '未配置 API Key',
        detail: '请先填写 API Key，或确认服务器 .env 中已配置 LLM_API_KEY',
        errorType: 'no_api_key',
      };
    }

    let client;
    try {
      client = createLLMClient({
        provider: input.provider,
        apiKey,
        baseURL: input.baseURL,
        model: input.model,
        temperature: input.temperature,
        maxTokens: input.maxTokens,
        timeoutMs: input.timeoutMs,
        rateLimitPerMin: input.rateLimitPerMin,
        source: 'env', // source 仅供展示，createLLMClient 不读取
      });
    } catch (err: any) {
      return {
        ...base,
        message: 'AI 服务未配置',
        detail: err?.message || String(err),
        errorType: 'no_api_key',
      };
    }

    const startedAt = Date.now();
    try {
      let reply = '';
      let finishReason: string | undefined;
      for await (const chunk of client.chat({
        messages: [{ role: 'user', content: 'ping' }],
        temperature: 0,
        maxTokens: 16, // 测试用最小回复，快速返回
      })) {
        if (chunk.delta) reply += chunk.delta;
        if (chunk.finishReason) finishReason = chunk.finishReason;
      }
      const latencyMs = Date.now() - startedAt;

      if (finishReason === 'error') {
        return {
          ...base,
          latencyMs,
          message: '模型返回错误',
          detail: reply || '未知错误',
          errorType: 'other',
        };
      }

      return {
        ok: true,
        provider: input.provider,
        model: input.model,
        latencyMs,
        reply: reply.trim() || undefined,
        message: '连接成功',
      };
    } catch (err: any) {
      const latencyMs = Date.now() - startedAt;
      const status = err?.status as number | undefined;
      const rawMsg = err?.message || String(err);
      const { message, errorType } = classifyTestError(status, rawMsg);
      return {
        ...base,
        latencyMs,
        message,
        detail: rawMsg,
        errorType,
      };
    }
  },
};
