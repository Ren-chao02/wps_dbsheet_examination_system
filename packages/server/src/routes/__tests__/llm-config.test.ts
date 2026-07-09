/**
 * LLM 配置路由测试 — GET/POST/DELETE /api/llm-config
 *
 * Mock authenticate/authorize（免 JWT）+ llmConfigService（免 DB）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

// ============================================================
// Mock：authenticate / authorize
// ============================================================
const { mockState, authMock } = vi.hoisted(() => {
  const mockState = { role: 'admin' };
  return {
    mockState,
    authMock: {
      authenticate: (req: any, res: any, next: any) => {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
          return res.status(401).json({ message: '未提供认证令牌' });
        }
        req.user = { id: 'u-1', userId: 'u-1', username: 'user', role: mockState.role };
        next();
      },
      authorize: (...roles: string[]) => (req: any, res: any, next: any) => {
        if (!req.user) return res.status(401).json({ message: '未认证' });
        if (!roles.includes(req.user.role)) {
          return res.status(403).json({ message: '权限不足' });
        }
        next();
      },
    },
  };
});

vi.mock('../../middleware/auth', () => authMock);

// ============================================================
// Mock：llmConfigService
// ============================================================
const { mockGetMasked, mockSave, mockClear } = vi.hoisted(() => ({
  mockGetMasked: vi.fn(),
  mockSave: vi.fn(),
  mockClear: vi.fn(),
}));

vi.mock('../../services/llm-config-service', () => ({
  llmConfigService: {
    getMasked: mockGetMasked,
    save: mockSave,
    clear: mockClear,
  },
}));

import { llmConfigRouter } from '../llm-config';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/llm-config', llmConfigRouter);
  return app;
}

const VALID_TOKEN = 'Bearer valid-admin-token';

describe('LLM 配置路由', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.role = 'admin';
  });

  // ── GET /api/llm-config ──
  describe('GET /api/llm-config', () => {
    it('返回脱敏配置', async () => {
      mockGetMasked.mockResolvedValue({
        provider: 'deepseek',
        hasApiKey: true,
        apiKeyMasked: 'sk-****abcd',
        baseURL: '',
        model: 'deepseek-chat',
        temperature: 0.4,
        maxTokens: 2048,
        timeoutMs: 60000,
        rateLimitPerMin: 20,
        source: 'db',
      });

      const res = await request(makeApp())
        .get('/api/llm-config')
        .set('Authorization', VALID_TOKEN);

      expect(res.status).toBe(200);
      expect(res.body.data.provider).toBe('deepseek');
      expect(res.body.data.hasApiKey).toBe(true);
      expect(res.body.data.apiKeyMasked).toBe('sk-****abcd');
      expect(res.body.data.source).toBe('db');
    });

    it('未认证返回 401', async () => {
      const res = await request(makeApp()).get('/api/llm-config');
      expect(res.status).toBe(401);
    });

    it('教师角色可访问（返回 200）', async () => {
      mockState.role = 'teacher';
      mockGetMasked.mockResolvedValue({
        provider: 'deepseek',
        hasApiKey: false,
        apiKeyMasked: '',
        baseURL: '',
        model: 'deepseek-chat',
        temperature: 0.4,
        maxTokens: 2048,
        timeoutMs: 60000,
        rateLimitPerMin: 20,
        source: 'env',
      });

      const res = await request(makeApp())
        .get('/api/llm-config')
        .set('Authorization', VALID_TOKEN);

      expect(res.status).toBe(200);
      expect(res.body.data.provider).toBe('deepseek');
    });

    it('学生角色返回 403', async () => {
      mockState.role = 'student';

      const res = await request(makeApp())
        .get('/api/llm-config')
        .set('Authorization', VALID_TOKEN);

      expect(res.status).toBe(403);
    });
  });

  // ── POST /api/llm-config ──
  describe('POST /api/llm-config', () => {
    it('保存配置成功', async () => {
      mockSave.mockResolvedValue({});

      const res = await request(makeApp())
        .post('/api/llm-config')
        .set('Authorization', VALID_TOKEN)
        .send({
          provider: 'deepseek',
          apiKey: 'sk-new-key-1234',
          baseURL: '',
          model: 'deepseek-chat',
          temperature: 0.4,
          maxTokens: 2048,
          timeoutMs: 60000,
          rateLimitPerMin: 20,
        });

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('配置已保存');
      expect(mockSave).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'deepseek',
          apiKey: 'sk-new-key-1234',
        }),
      );
    });

    it('apiKey 为空时仍可保存（保留旧值）', async () => {
      mockSave.mockResolvedValue({});

      const res = await request(makeApp())
        .post('/api/llm-config')
        .set('Authorization', VALID_TOKEN)
        .send({
          provider: 'qwen',
          apiKey: '',
          baseURL: '',
          model: 'qwen-plus',
          temperature: 0.3,
          maxTokens: 4096,
          timeoutMs: 60000,
          rateLimitPerMin: 20,
        });

      expect(res.status).toBe(200);
      expect(mockSave).toHaveBeenCalledWith(
        expect.objectContaining({ apiKey: '' }),
      );
    });

    it('缺少 provider 返回 400', async () => {
      const res = await request(makeApp())
        .post('/api/llm-config')
        .set('Authorization', VALID_TOKEN)
        .send({ apiKey: 'sk-test' });

      expect(res.status).toBe(400);
    });

    it('未认证返回 401', async () => {
      const res = await request(makeApp())
        .post('/api/llm-config')
        .send({ provider: 'deepseek' });

      expect(res.status).toBe(401);
    });
  });

  // ── DELETE /api/llm-config ──
  describe('DELETE /api/llm-config', () => {
    it('清除 DB 配置成功', async () => {
      mockClear.mockResolvedValue({ count: 1 });

      const res = await request(makeApp())
        .delete('/api/llm-config')
        .set('Authorization', VALID_TOKEN);

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('配置已清除，回退到环境变量');
      expect(mockClear).toHaveBeenCalled();
    });

    it('未认证返回 401', async () => {
      const res = await request(makeApp()).delete('/api/llm-config');
      expect(res.status).toBe(401);
    });
  });
});
