/**
 * WPS Token 配置路由 — 服务端 CRUD
 */
import { Router, Request, Response } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { prisma } from '../config/prisma';
import { wpsConfigService } from '../services/wps-config-service';

export const wpsConfigRouter = Router();

wpsConfigRouter.use(authenticate);
wpsConfigRouter.use(authorize('teacher', 'admin'));

// GET /api/wps-config — 从数据库加载当前 Token
wpsConfigRouter.get('/', async (_req: Request, res: Response) => {
  try {
    const cfg = await wpsConfigService.get();
    if (!cfg) {
      return res.json({ data: null });
    }
    res.json({
      data: {
        accessToken: cfg.accessToken,
        refreshToken: cfg.refreshToken,
        expiresAt: Number(cfg.expiresAt),
        refreshExpiresAt: Number(cfg.refreshExpiresAt),
      },
    });
  } catch {
    res.status(500).json({ message: '服务器错误' });
  }
});

// POST /api/wps-config — 保存 Token 到数据库
wpsConfigRouter.post('/', async (req: Request, res: Response) => {
  try {
    const { accessToken, refreshToken, expiresIn, refreshExpiresIn } = req.body;
    if (!accessToken) {
      return res.status(400).json({ message: '缺少 access_token' });
    }
    await wpsConfigService.save({
      accessToken,
      refreshToken: refreshToken || '',
      expiresIn: expiresIn || 7200,
      refreshExpiresIn: refreshExpiresIn || 2592000,
    });
    res.json({ message: 'Token 已保存到服务端' });
  } catch (err: any) {
    res.status(500).json({ message: '保存失败', detail: err.message });
  }
});

// DELETE /api/wps-config — 清除服务端 Token
wpsConfigRouter.delete('/', async (_req: Request, res: Response) => {
  try {
    await prisma.wpsConfig.deleteMany();
    res.json({ message: 'Token 已清除' });
  } catch (err: any) {
    res.status(500).json({ message: '清除失败', detail: err.message });
  }
});
