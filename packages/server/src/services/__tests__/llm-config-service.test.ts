/**
 * llmConfigService 测试 — DB CRUD + getEffective (DB→env 兜底) + getMasked (脱敏)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.hoisted 确保 mock 函数在 vi.mock 工厂执行前已初始化
const { mockLlmConfigFindUnique, mockLlmConfigUpsert, mockLlmConfigDeleteMany, envLlmConfig } = vi.hoisted(() => ({
  mockLlmConfigFindUnique: vi.fn(),
  mockLlmConfigUpsert: vi.fn(),
  mockLlmConfigDeleteMany: vi.fn(),
  envLlmConfig: {
    provider: 'deepseek',
    apiKey: 'env-key-xxxx',
    baseURL: '',
    model: 'deepseek-chat',
    temperature: 0.4,
    maxTokens: 2048,
    timeoutMs: 60000,
    rateLimitPerMin: 20,
  },
}));

vi.mock('../../config/prisma', () => ({
  prisma: {
    llmConfig: {
      findUnique: mockLlmConfigFindUnique,
      upsert: mockLlmConfigUpsert,
      deleteMany: mockLlmConfigDeleteMany,
    },
  },
}));

vi.mock('../../config', () => ({
  config: {
    llm: envLlmConfig,
  },
}));

// Mock createLLMClient：测试连接逻辑，不真正请求外部 LLM
const { mockCreateLLMClient } = vi.hoisted(() => ({
  mockCreateLLMClient: vi.fn(),
}));

vi.mock('../../llm/create-client', () => ({
  createLLMClient: mockCreateLLMClient,
}));

import { llmConfigService } from '../llm-config-service';

describe('llmConfigService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 恢复 env config 默认值
    envLlmConfig.apiKey = 'env-key-xxxx';
  });

  // ── getEffective ──
  describe('getEffective', () => {
    it('DB 有配置时返回 DB 配置 (source=db)', async () => {
      mockLlmConfigFindUnique.mockResolvedValue({
        id: 'llm_config',
        provider: 'qwen',
        apiKey: 'db-key-abcd',
        baseURL: 'https://custom.example.com',
        model: 'qwen-plus',
        temperature: 0.3,
        maxTokens: 4096,
        timeoutMs: 30000,
        rateLimitPerMin: 10,
        updatedAt: new Date(),
      });

      const result = await llmConfigService.getEffective();

      expect(result.source).toBe('db');
      expect(result.provider).toBe('qwen');
      expect(result.apiKey).toBe('db-key-abcd');
      expect(result.model).toBe('qwen-plus');
      expect(result.temperature).toBe(0.3);
      expect(result.maxTokens).toBe(4096);
    });

    it('DB 无配置时回退到 env (source=env)', async () => {
      mockLlmConfigFindUnique.mockResolvedValue(null);

      const result = await llmConfigService.getEffective();

      expect(result.source).toBe('env');
      expect(result.provider).toBe('deepseek');
      expect(result.apiKey).toBe('env-key-xxxx');
      expect(result.model).toBe('deepseek-chat');
    });

    it('DB 配置优先于 env', async () => {
      mockLlmConfigFindUnique.mockResolvedValue({
        id: 'llm_config',
        provider: 'glm',
        apiKey: 'db-glm-key',
        baseURL: '',
        model: 'glm-4',
        temperature: 0.5,
        maxTokens: 1024,
        timeoutMs: 45000,
        rateLimitPerMin: 15,
        updatedAt: new Date(),
      });

      const result = await llmConfigService.getEffective();

      expect(result.provider).toBe('glm');
      expect(result.apiKey).toBe('db-glm-key');
      expect(result.model).toBe('glm-4');
    });
  });

  // ── getMasked ──
  describe('getMasked', () => {
    it('脱敏 API Key (保留前3后4)', async () => {
      mockLlmConfigFindUnique.mockResolvedValue({
        id: 'llm_config',
        provider: 'deepseek',
        apiKey: 'sk-1234567890abcdef',
        baseURL: '',
        model: 'deepseek-chat',
        temperature: 0.4,
        maxTokens: 2048,
        timeoutMs: 60000,
        rateLimitPerMin: 20,
        updatedAt: new Date(),
      });

      const result = await llmConfigService.getMasked();

      expect(result.hasApiKey).toBe(true);
      // "sk-1234567890abcdef" = 19 chars; first 3 + 12 asterisks + last 4
      expect(result.apiKeyMasked).toBe('sk-************cdef');
      expect(result.source).toBe('db');
    });

    it('短 key 全部脱敏', async () => {
      mockLlmConfigFindUnique.mockResolvedValue({
        id: 'llm_config',
        provider: 'deepseek',
        apiKey: 'short',
        baseURL: '',
        model: 'deepseek-chat',
        temperature: 0.4,
        maxTokens: 2048,
        timeoutMs: 60000,
        rateLimitPerMin: 20,
        updatedAt: new Date(),
      });

      const result = await llmConfigService.getMasked();

      expect(result.hasApiKey).toBe(true);
      expect(result.apiKeyMasked).toBe('****');
    });

    it('DB 无配置时返回 env 脱敏 (source=env)', async () => {
      mockLlmConfigFindUnique.mockResolvedValue(null);

      const result = await llmConfigService.getMasked();

      expect(result.source).toBe('env');
      expect(result.hasApiKey).toBe(true);
      expect(result.apiKeyMasked).toContain('****');
      expect(result.apiKeyMasked).toContain('xxxx');
    });

    it('env 也无 key 时 hasApiKey=false', async () => {
      mockLlmConfigFindUnique.mockResolvedValue(null);
      envLlmConfig.apiKey = '';

      const result = await llmConfigService.getMasked();

      expect(result.hasApiKey).toBe(false);
      expect(result.apiKeyMasked).toBe('');
    });
  });

  // ── save ──
  describe('save', () => {
    it('调用 upsert 保存配置', async () => {
      mockLlmConfigUpsert.mockResolvedValue({});

      await llmConfigService.save({
        provider: 'deepseek',
        apiKey: 'sk-new-key',
        baseURL: '',
        model: 'deepseek-chat',
        temperature: 0.4,
        maxTokens: 2048,
        timeoutMs: 60000,
        rateLimitPerMin: 20,
      });

      expect(mockLlmConfigUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'llm_config' },
          create: expect.objectContaining({
            provider: 'deepseek',
            apiKey: 'sk-new-key',
          }),
        }),
      );
    });

    it('apiKey 为空时保留旧值', async () => {
      mockLlmConfigFindUnique.mockResolvedValue({
        id: 'llm_config',
        provider: 'deepseek',
        apiKey: 'sk-old-key-1234',
        baseURL: '',
        model: 'deepseek-chat',
        temperature: 0.4,
        maxTokens: 2048,
        timeoutMs: 60000,
        rateLimitPerMin: 20,
        updatedAt: new Date(),
      });

      await llmConfigService.save({
        provider: 'deepseek',
        apiKey: '',  // 空 = 不改
        baseURL: 'https://new.url',
        model: 'deepseek-chat',
        temperature: 0.4,
        maxTokens: 2048,
        timeoutMs: 60000,
        rateLimitPerMin: 20,
      });

      expect(mockLlmConfigUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            apiKey: 'sk-old-key-1234',  // 保留旧值
            baseURL: 'https://new.url',
          }),
        }),
      );
    });
  });

  // ── clear ──
  describe('clear', () => {
    it('调用 deleteMany 清除 DB 配置', async () => {
      mockLlmConfigDeleteMany.mockResolvedValue({ count: 1 });

      await llmConfigService.clear();

      expect(mockLlmConfigDeleteMany).toHaveBeenCalled();
    });
  });

  // ── testConnection ──
  describe('testConnection', () => {
    const baseInput = {
      provider: 'deepseek',
      apiKey: 'sk-test-key',
      baseURL: '',
      model: 'deepseek-chat',
      temperature: 0.4,
      maxTokens: 2048,
      timeoutMs: 60000,
      rateLimitPerMin: 20,
    };

    /** 伪造 LLMClient：可配置流式 chunk 或抛错 */
    function fakeClient(chunks: any[] = [], error?: Error) {
      return {
        chat: async function* () {
          if (error) throw error;
          for (const c of chunks) yield c;
        },
      };
    }

    it('连接成功：聚合流式回复并返回耗时', async () => {
      mockCreateLLMClient.mockReturnValue(
        fakeClient([{ delta: 'pong' }, { finishReason: 'stop' }]),
      );

      const result = await llmConfigService.testConnection(baseInput);

      expect(result.ok).toBe(true);
      expect(result.provider).toBe('deepseek');
      expect(result.model).toBe('deepseek-chat');
      expect(result.reply).toBe('pong');
      expect(typeof result.latencyMs).toBe('number');
      expect(mockCreateLLMClient).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'deepseek',
          apiKey: 'sk-test-key',
          model: 'deepseek-chat',
        }),
      );
    });

    it('apiKey 为空时回退到已生效 env key', async () => {
      mockLlmConfigFindUnique.mockResolvedValue(null); // DB 无配置 → env
      envLlmConfig.apiKey = 'env-key-xxxx';
      mockCreateLLMClient.mockReturnValue(fakeClient([{ finishReason: 'stop' }]));

      const result = await llmConfigService.testConnection({
        ...baseInput,
        apiKey: '',
      });

      expect(result.ok).toBe(true);
      expect(mockCreateLLMClient).toHaveBeenCalledWith(
        expect.objectContaining({ apiKey: 'env-key-xxxx' }),
      );
    });

    it('无任何 key（非 ollama）返回 no_api_key', async () => {
      mockLlmConfigFindUnique.mockResolvedValue(null);
      envLlmConfig.apiKey = '';

      const result = await llmConfigService.testConnection({
        ...baseInput,
        apiKey: '',
      });

      expect(result.ok).toBe(false);
      expect(result.errorType).toBe('no_api_key');
      expect(mockCreateLLMClient).not.toHaveBeenCalled();
    });

    it('ollama 无 key 仍可测试', async () => {
      mockCreateLLMClient.mockReturnValue(fakeClient([{ finishReason: 'stop' }]));

      const result = await llmConfigService.testConnection({
        ...baseInput,
        provider: 'ollama',
        model: 'qwen2.5:7b',
        apiKey: '',
      });

      expect(result.ok).toBe(true);
      expect(mockCreateLLMClient).toHaveBeenCalled();
    });

    it('401 → invalid_api_key', async () => {
      mockCreateLLMClient.mockReturnValue(
        fakeClient([], Object.assign(new Error('401 invalid key'), { status: 401 })),
      );

      const result = await llmConfigService.testConnection(baseInput);

      expect(result.ok).toBe(false);
      expect(result.errorType).toBe('invalid_api_key');
      expect(result.message).toContain('API Key 无效');
    });

    it('404 → invalid_model', async () => {
      mockCreateLLMClient.mockReturnValue(
        fakeClient([], Object.assign(new Error('404 model not found'), { status: 404 })),
      );

      const result = await llmConfigService.testConnection(baseInput);

      expect(result.ok).toBe(false);
      expect(result.errorType).toBe('invalid_model');
    });

    it('无 status 且超时 → timeout', async () => {
      mockCreateLLMClient.mockReturnValue(
        fakeClient([], new Error('Request timed out.')),
      );

      const result = await llmConfigService.testConnection(baseInput);

      expect(result.ok).toBe(false);
      expect(result.errorType).toBe('timeout');
    });

    it('无 status 网络错误 → network', async () => {
      mockCreateLLMClient.mockReturnValue(
        fakeClient([], new Error('getaddrinfo ENOTFOUND api.deepseek.com')),
      );

      const result = await llmConfigService.testConnection(baseInput);

      expect(result.ok).toBe(false);
      expect(result.errorType).toBe('network');
    });
  });
});
