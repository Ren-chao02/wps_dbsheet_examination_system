/**
 * AI 对话式教练路由 — Phase 2 §4.8
 *
 * 单一 SSE 端点：POST /api/coaching/chat
 *   鉴权（teacher/admin）→ 速率限制 → zod 校验 → 构造 ToolContext + LLMClient
 *   → 调用 runCoachingChat → 将 CoachingStreamEvent 逐条写为 SSE
 *
 * 不变量：
 *   - accessToken 永不进 LLM（KingsoftAdapter 封装凭据，tool handler 本地执行）
 *   - LLM 未配置时返回 503（非 500），让前端区分「服务降级」与「服务器错误」
 *
 * @see docs/superpowers/specs/2026-07-08-phase2-ai-coaching-design.md §4.8
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { authenticate, authorize } from '../middleware/auth';
import { createLLMClient } from '../llm/create-client';
import { runCoachingChat } from '../services/coaching-service';
import { llmConfigService } from '../services/llm-config-service';
import { KingsoftAdapter } from '../engine/adapters/kingsoft-adapter';
import { answerReverser } from '../engine/answer-reverser';
import { config } from '../config';
import type { ToolContext } from '../coaching/tools';
import type { ChatMessage } from '../llm/llm-client';

export const coachingRouter = Router();
coachingRouter.use(authenticate);

// ============================================================
// 速率限制（按用户，每分钟 N 次）
// ============================================================

/**
 * 创建 coaching 速率限制中间件。
 * 导出工厂便于测试注入低 max 值触发 429。
 */
export function createCoachingLimiter(max: number = config.llm.rateLimitPerMin) {
  return rateLimit({
    windowMs: 60 * 1000,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req: Request) => req.user?.userId || ipKeyGenerator(req.ip || 'unknown'),
    message: { message: 'AI 对话请求过于频繁，请稍后再试' },
  });
}

// ============================================================
// 请求体校验
// ============================================================

const chatSchema = z.object({
  questionState: z.object({
    title: z.string(),
    description: z.string(),
    type: z.string(),
    difficulty: z.string(),
    score: z.number(),
    selectedCapabilityIds: z.array(z.string()),
    currentRules: z.array(
      z.object({
        id: z.string(),
        action: z.string(),
        tableName: z.string().optional(),
        fieldName: z.string().optional(),
        score: z.number(),
      }),
    ),
    hints: z.string().optional(),
  }),
  history: z.array(
    z.object({
      role: z.string(),
      content: z.string(),
    }),
  ),
  fileId: z.string().optional(),
  accessToken: z.string().optional(),
  apiSecret: z.string().optional(),
});

// ============================================================
// SSE 处理器（导出便于测试单独挂载）
// ============================================================

export async function handleCoachingChat(req: Request, res: Response): Promise<void> {
  const parsed = chatSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: '参数错误', errors: parsed.error.flatten() });
    return;
  }

  const { questionState, history, fileId, accessToken, apiSecret } = parsed.data;

  // 构造 ToolContext：有 fileId + accessToken 才有 adapter（grounding 用）
  const ctx: ToolContext = {};
  if (fileId && accessToken) {
    ctx.adapter = new KingsoftAdapter(fileId, accessToken, apiSecret);
  }

  // 构造 LLMClient：从 DB 取生效配置（DB > env），未配置 API_KEY 时 503
  let client;
  try {
    const llmConfig = await llmConfigService.getEffective();
    client = createLLMClient(llmConfig);
  } catch (e: any) {
    res.status(503).json({ message: e?.message || 'AI 服务未配置' });
    return;
  }

  // SSE 响应头
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // 禁用 Nginx 缓冲
  res.flushHeaders?.();

  const send = (event: string, data: unknown) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    for await (const evt of runCoachingChat({
      questionState,
      history: history as ChatMessage[],
      ctx,
      client,
      answerReverser,
    })) {
      switch (evt.type) {
        case 'delta':
          send('delta', { text: evt.text });
          break;
        case 'proposals':
          send('proposals', { proposals: evt.proposals, notes: evt.notes });
          break;
        case 'done':
          send('done', { usage: evt.usage });
          break;
        case 'error':
          send('error', { message: evt.message });
          break;
      }
    }
  } catch (e: any) {
    send('error', { message: e?.message || '服务器错误' });
  } finally {
    res.end();
  }
}

// ============================================================
// 路由注册
// ============================================================

coachingRouter.post(
  '/chat',
  authorize('teacher', 'admin'),
  createCoachingLimiter(),
  handleCoachingChat,
);
