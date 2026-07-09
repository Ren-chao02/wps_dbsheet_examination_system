/**
 * AI 对话式教练路由集成测试 — Phase 2 §4.8
 *
 * 覆盖：
 * - POST /api/coaching/chat（SSE 流式）
 *
 * 通过 vi.mock 替换 authenticate / authorize（免 JWT/DB）、
 * createLLMClient（免真实 LLM）、runCoachingChat（免真实流式编排）、
 * KingsoftAdapter（免真实 WPS 调用）。
 *
 * 用 supertest 驱动 Express 路由。SSE 响应体在 res.end() 后被 supertest
 * 完整缓冲到 res.text，测试中直接解析原始 SSE 文本。
 *
 * @see docs/superpowers/specs/2026-07-08-phase2-ai-coaching-design.md §4.8
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

// ============================================================
// Mock：authenticate / authorize — 免 JWT、免 DB
// ============================================================

/** 控制 mock 用户的角色；测试用例可覆盖 */
let mockRole: string = 'teacher';

vi.mock('../../middleware/auth', () => ({
  authenticate: (req: any, res: any, next: any) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: '未提供认证令牌' });
    }
    req.user = {
      id: 'u-teacher-1',
      userId: 'u-teacher-1',
      username: 'teacher1',
      role: mockRole,
    };
    next();
  },
  authorize: (...roles: string[]) => (req: any, res: any, next: any) => {
    if (!req.user) return res.status(401).json({ message: '未认证' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ message: '权限不足' });
    }
    next();
  },
}));

// ============================================================
// Mock：createLLMClient — 免真实 LLM 调用
// ============================================================

let mockLLMClientError: Error | null = null;

vi.mock('../../llm/create-client', () => ({
  createLLMClient: () => {
    if (mockLLMClientError) throw mockLLMClientError;
    return { provider: 'mock' };
  },
}));

// ============================================================
// Mock：llmConfigService — 免 DB，返回固定生效配置
// ============================================================

vi.mock('../../services/llm-config-service', () => ({
  llmConfigService: {
    getEffective: async () => ({
      provider: 'deepseek',
      apiKey: 'test-key',
      baseURL: '',
      model: 'deepseek-chat',
      temperature: 0.4,
      maxTokens: 2048,
      timeoutMs: 60000,
      rateLimitPerMin: 20,
      source: 'env',
    }),
  },
}));

// ============================================================
// Mock：runCoachingChat — 控制事件序列 + 捕获参数
// ============================================================

let mockEvents: any[] = [];
let capturedParams: any = null;

vi.mock('../../services/coaching-service', () => ({
  runCoachingChat: async function* (params: any): AsyncIterable<any> {
    capturedParams = params;
    for (const e of mockEvents) yield e;
  },
}));

// ============================================================
// Mock：KingsoftAdapter — 免真实 WPS 调用
// ============================================================

let adapterConstructArgs: any[] | null = null;

vi.mock('../../engine/adapters/kingsoft-adapter', () => ({
  KingsoftAdapter: class MockKingsoftAdapter {
    constructor(...args: any[]) {
      adapterConstructArgs = args;
    }
  },
}));

// mock 生效后导入路由 + mocked 中间件
import { authenticate, authorize } from '../../middleware/auth';
import {
  coachingRouter,
  createCoachingLimiter,
  handleCoachingChat,
} from '../coaching';

// ============================================================
// 测试辅助
// ============================================================

const TEACHER_TOKEN = 'Bearer mock-teacher-token';
const STUDENT_TOKEN = 'Bearer mock-student-token';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/coaching', coachingRouter);
  return app;
}

/** 用于 429 测试：独立 limiter（低 max），避免与其他测试共享计数 */
function makeLimitedApp(max: number) {
  const app = express();
  app.use(express.json());
  app.post(
    '/api/coaching/chat',
    authenticate,
    authorize('teacher', 'admin'),
    createCoachingLimiter(max),
    handleCoachingChat,
  );
  return app;
}

function makeValidBody() {
  return {
    questionState: {
      title: '创建考勤表',
      description: '请创建一个考勤表',
      type: 'comprehensive',
      difficulty: 'medium',
      score: 10,
      selectedCapabilityIds: ['table.create'],
      currentRules: [],
      hints: '',
    },
    history: [],
  };
}

/** 解析 SSE 文本为事件数组 */
function parseSSE(text: string): Array<{ event: string; data: any }> {
  const events: Array<{ event: string; data: any }> = [];
  const blocks = text.split('\n\n').filter((b) => b.trim());
  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l.trim());
    let event = '';
    let data = '';
    for (const line of lines) {
      if (line.startsWith('event: ')) event = line.slice(7).trim();
      if (line.startsWith('data: ')) data = line.slice(6);
    }
    events.push({ event, data: data ? JSON.parse(data) : null });
  }
  return events;
}

// ============================================================
// 测试
// ============================================================

describe('POST /api/coaching/chat', () => {
  beforeEach(() => {
    mockRole = 'teacher';
    mockLLMClientError = null;
    mockEvents = [];
    capturedParams = null;
    adapterConstructArgs = null;
  });

  it('未认证返回 401', async () => {
    const app = makeApp();
    const res = await request(app)
      .post('/api/coaching/chat')
      .send(makeValidBody());
    expect(res.status).toBe(401);
    expect(res.body.message).toBe('未提供认证令牌');
  });

  it('学生角色返回 403', async () => {
    mockRole = 'student';
    const app = makeApp();
    const res = await request(app)
      .post('/api/coaching/chat')
      .set('Authorization', STUDENT_TOKEN)
      .send(makeValidBody());
    expect(res.status).toBe(403);
  });

  it('缺 questionState 返回 400', async () => {
    const app = makeApp();
    const res = await request(app)
      .post('/api/coaching/chat')
      .set('Authorization', TEACHER_TOKEN)
      .send({ history: [] });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('参数错误');
  });

  it('正常 SSE 流：delta + proposals + done', async () => {
    mockEvents = [
      { type: 'delta', text: '你好' },
      { type: 'delta', text: '，老师' },
      { type: 'proposals', proposals: [], notes: ['暂无建议'] },
      { type: 'done', usage: { promptTokens: 100, completionTokens: 50 } },
    ];
    const app = makeApp();
    const res = await request(app)
      .post('/api/coaching/chat')
      .set('Authorization', TEACHER_TOKEN)
      .send(makeValidBody());

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');

    const events = parseSSE(res.text);
    expect(events).toHaveLength(4);
    expect(events[0].event).toBe('delta');
    expect(events[0].data.text).toBe('你好');
    expect(events[1].event).toBe('delta');
    expect(events[1].data.text).toBe('，老师');
    expect(events[2].event).toBe('proposals');
    expect(events[2].data.proposals).toEqual([]);
    expect(events[2].data.notes).toContain('暂无建议');
    expect(events[3].event).toBe('done');
    expect(events[3].data.usage.promptTokens).toBe(100);
  });

  it('SSE error 事件透传错误信息', async () => {
    mockEvents = [
      { type: 'delta', text: '部分文字' },
      { type: 'error', message: 'LLM 调用失败' },
    ];
    const app = makeApp();
    const res = await request(app)
      .post('/api/coaching/chat')
      .set('Authorization', TEACHER_TOKEN)
      .send(makeValidBody());

    expect(res.status).toBe(200);
    const events = parseSSE(res.text);
    expect(events).toHaveLength(2);
    expect(events[0].event).toBe('delta');
    expect(events[1].event).toBe('error');
    expect(events[1].data.message).toBe('LLM 调用失败');
  });

  it('LLM 未配置返回 503', async () => {
    mockLLMClientError = new Error('AI 服务未配置：缺少 LLM_API_KEY');
    const app = makeApp();
    const res = await request(app)
      .post('/api/coaching/chat')
      .set('Authorization', TEACHER_TOKEN)
      .send(makeValidBody());
    expect(res.status).toBe(503);
    expect(res.body.message).toContain('AI 服务未配置');
  });

  it('提供 fileId + accessToken 时构造 KingsoftAdapter 并传入 ctx', async () => {
    mockEvents = [
      { type: 'done', usage: { promptTokens: 0, completionTokens: 0 } },
    ];
    const app = makeApp();
    const res = await request(app)
      .post('/api/coaching/chat')
      .set('Authorization', TEACHER_TOKEN)
      .send({ ...makeValidBody(), fileId: 'file-1', accessToken: 'token-1' });

    expect(res.status).toBe(200);
    expect(adapterConstructArgs).toEqual(['file-1', 'token-1', undefined]);
    expect(capturedParams).not.toBeNull();
    expect(capturedParams.ctx.adapter).toBeDefined();
  });

  it('未提供 fileId 时 ctx.adapter 为空（降级模式）', async () => {
    mockEvents = [
      { type: 'done', usage: { promptTokens: 0, completionTokens: 0 } },
    ];
    const app = makeApp();
    const res = await request(app)
      .post('/api/coaching/chat')
      .set('Authorization', TEACHER_TOKEN)
      .send(makeValidBody());

    expect(res.status).toBe(200);
    expect(adapterConstructArgs).toBeNull();
    expect(capturedParams).not.toBeNull();
    expect(capturedParams.ctx.adapter).toBeUndefined();
  });

  it('超过速率限制返回 429', async () => {
    mockEvents = [
      { type: 'done', usage: { promptTokens: 0, completionTokens: 0 } },
    ];
    const app = makeLimitedApp(1);

    // 第一次请求：正常
    const res1 = await request(app)
      .post('/api/coaching/chat')
      .set('Authorization', TEACHER_TOKEN)
      .send(makeValidBody());
    expect(res1.status).toBe(200);

    // 第二次请求：429
    const res2 = await request(app)
      .post('/api/coaching/chat')
      .set('Authorization', TEACHER_TOKEN)
      .send(makeValidBody());
    expect(res2.status).toBe(429);
  });
});
