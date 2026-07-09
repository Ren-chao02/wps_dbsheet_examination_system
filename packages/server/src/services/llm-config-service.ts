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

/** 脱敏 API Key：保留前3后4，中间用星号填充；太短则全星号 */
function maskApiKey(key: string): string {
  if (!key) return '';
  if (key.length <= 7) return '****';
  return key.slice(0, 3) + '*'.repeat(key.length - 7) + key.slice(-4);
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
};
