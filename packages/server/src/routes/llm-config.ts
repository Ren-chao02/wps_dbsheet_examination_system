/**
 * LLM 大模型配置路由 — 管理员前端配置 LLM API Key 等
 *
 * GET    /api/llm-config  — 返回脱敏配置（apiKey 脱敏为 sk-****abcd）
 * POST   /api/llm-config  — 保存配置（apiKey 为空 = 保留旧值）
 * DELETE /api/llm-config  — 清除 DB 配置（回退到 .env 环境变量）
 *
 * 管理员与教师可访问（与 WPS Token 管理同模式：教师需自行配置 AI 服务才能用教练功能）。
 *
 * @see llm-config-service.ts
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../middleware/auth';
import { llmConfigService } from '../services/llm-config-service';

export const llmConfigRouter = Router();

llmConfigRouter.use(authenticate);
llmConfigRouter.use(authorize('admin', 'teacher'));

// ── POST 校验 schema ──
const saveSchema = z.object({
  provider: z.string().min(1, '请选择 Provider'),
  apiKey: z.string().default(''),           // 空 = 保留旧值
  baseURL: z.string().default(''),
  model: z.string().min(1, '请输入模型名称'),
  temperature: z.number().min(0).max(2).default(0.4),
  maxTokens: z.number().int().min(1).max(32768).default(2048),
  timeoutMs: z.number().int().min(1000).max(600000).default(60000),
  rateLimitPerMin: z.number().int().min(1).max(1000).default(20),
});

// GET /api/llm-config — 返回脱敏配置
llmConfigRouter.get('/', async (_req: Request, res: Response) => {
  try {
    const masked = await llmConfigService.getMasked();
    res.json({ data: masked });
  } catch (err: any) {
    res.status(500).json({ message: '读取配置失败', detail: err.message });
  }
});

// POST /api/llm-config — 保存配置
llmConfigRouter.post('/', async (req: Request, res: Response) => {
  const parsed = saveSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      message: '参数错误',
      errors: parsed.error.flatten(),
    });
  }

  try {
    await llmConfigService.save(parsed.data);
    res.json({ message: '配置已保存' });
  } catch (err: any) {
    res.status(500).json({ message: '保存失败', detail: err.message });
  }
});

// DELETE /api/llm-config — 清除 DB 配置（回退到 env）
llmConfigRouter.delete('/', async (_req: Request, res: Response) => {
  try {
    await llmConfigService.clear();
    res.json({ message: '配置已清除，回退到环境变量' });
  } catch (err: any) {
    res.status(500).json({ message: '清除失败', detail: err.message });
  }
});
