/**
 * LLM 客户端工厂 — Phase 2 §4.1
 *
 * 按 LLM 配置选择 provider 并构造 LLMClient。
 * MVP：所有 OpenAI 兼容 provider（DeepSeek/Qwen/GLM/Ollama-OpenAI）走 OpenAICompatibleClient。
 *
 * 配置来源（优先级）：DB（前端配置）> .env 环境变量
 * 路由层通过 llmConfigService.getEffective() 获取生效配置后传入。
 */
import OpenAI from 'openai';
import { config } from '../config';
import { OpenAICompatibleClient } from './providers/openai-compatible';
import type { LLMClient } from './llm-client';
import type { LlmEffectiveConfig } from '../services/llm-config-service';

/** 各 provider 的默认 OpenAI 兼容端点（LLM_BASE_URL 为空时使用） */
const PROVIDER_BASE_URLS: Record<string, string> = {
  deepseek: 'https://api.deepseek.com',
  qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  glm: 'https://open.bigmodel.cn/api/paas/v4',
  ollama: 'http://localhost:11434/v1',
};

/**
 * 从生效的 LLM 配置构造 LLMClient。
 * @param llmConfig 生效配置（来自 llmConfigService.getEffective()）
 * @throws 缺 apiKey 时抛错（路由层捕获返回 503「AI 服务未配置」）
 */
export function createLLMClient(llmConfig?: LlmEffectiveConfig): LLMClient {
  // 未传参时回退到 env config（向后兼容）
  const cfg = llmConfig || {
    provider: config.llm.provider,
    apiKey: config.llm.apiKey,
    baseURL: config.llm.baseURL,
    model: config.llm.model,
    temperature: config.llm.temperature,
    maxTokens: config.llm.maxTokens,
    timeoutMs: config.llm.timeoutMs,
    rateLimitPerMin: config.llm.rateLimitPerMin,
    source: 'env' as const,
  };

  const { provider, apiKey, baseURL, model, temperature, maxTokens, timeoutMs } = cfg;
  if (!apiKey && provider !== 'ollama') {
    throw new Error('AI 服务未配置：缺少 LLM_API_KEY');
  }

  const finalBaseURL = baseURL || PROVIDER_BASE_URLS[provider] || PROVIDER_BASE_URLS.deepseek;

  const openaiClient = new OpenAI({
    apiKey: apiKey || 'ollama-no-key',
    baseURL: finalBaseURL,
    timeout: timeoutMs,
  });

  return new OpenAICompatibleClient({
    client: openaiClient,
    model,
    temperature,
    maxTokens,
    timeoutMs,
  });
}
